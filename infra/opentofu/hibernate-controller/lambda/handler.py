import json
import logging
import os
import secrets
import time
import urllib.error
import urllib.request
from decimal import Decimal

import boto3
from botocore.exceptions import ClientError

LOGGER = logging.getLogger()
LOGGER.setLevel(logging.INFO)

STATE_PK = "stack"
STATUS_AWAKE = "AWAKE"
STATUS_WAKING = "WAKING"
STATUS_SLEEPING = "SLEEPING"

ecs = boto3.client("ecs")
ec2 = boto3.client("ec2")
elbv2 = boto3.client("elbv2")
dynamodb = boto3.resource("dynamodb")


def lambda_handler(event, context):
    if _is_tick_event(event):
        result = handle_tick()
        LOGGER.info("tick result %s", json.dumps(result, default=str))
        return result

    if _is_http_event(event):
        return handle_http(event)

    LOGGER.warning("unknown event, treating as tick")
    return handle_tick()


def handle_http(event):
    method = (
        event.get("requestContext", {}).get("http", {}).get("method") or "GET"
    ).upper()
    if method == "OPTIONS":
        return _http_response(204, "")

    if not _authorized(event):
        return _http_response(401, {"error": "unauthorized"})

    try:
        if method == "GET":
            snapshot = _probe()
            state = _get_state()
            reconciled = _reconcile_status(state, snapshot)
            return _http_response(200, _public_payload(reconciled, snapshot))

        if method in ("POST", "PUT"):
            result = handle_wake()
            status_code = 200 if result.get("ready") else 202
            return _http_response(status_code, result)
    except ClientError as exc:
        LOGGER.exception("aws error")
        return _http_response(503, {"error": "aws_error", "message": str(exc)})
    except Exception as exc:  # noqa: BLE001
        LOGGER.exception("wake handler failed")
        return _http_response(500, {"error": "internal_error", "message": str(exc)})

    return _http_response(405, {"error": "method_not_allowed"})


def handle_tick():
    snapshot = _probe()
    state = _get_state()
    status = state.get("status") or STATUS_SLEEPING
    now = int(time.time())

    if status == STATUS_SLEEPING:
        leftover = snapshot["ecs_running"] >= 1 or snapshot["ec2"] == "running"
        if leftover:
            state = _put_state(
                {
                    **state,
                    "status": STATUS_AWAKE,
                    "last_idle_since": now,
                    "wake_started_at": None,
                }
            )
        return _public_payload(state, snapshot)

    if status == STATUS_WAKING:
        if snapshot["ready"]:
            state = _put_state(
                {
                    **state,
                    "status": STATUS_AWAKE,
                    "last_idle_since": now,
                    "wake_started_at": None,
                }
            )
            return _public_payload(state, snapshot)
        wake_started_at = _as_int(state.get("wake_started_at"), 0)
        if wake_started_at and now - wake_started_at > 120:
            _start_compute()
            state = _put_state({**state, "wake_started_at": now})
        return _public_payload(state, snapshot)

    if not snapshot["signaling_http_ok"] and not snapshot["ecs_running"]:
        # Stack drifted down without going through sleep.
        state = _put_state(
            {
                **state,
                "status": STATUS_SLEEPING,
                "last_idle_since": now,
                "wake_started_at": None,
            }
        )
        return _public_payload(state, snapshot)

    if bool(state.get("force_awake")):
        return _public_payload(
            _put_state({**state, "last_idle_since": None}), snapshot
        )

    if snapshot["busy"]:
        state = _put_state({**state, "status": STATUS_AWAKE, "last_idle_since": None})
        return _public_payload(state, snapshot)

    last_idle_since = state.get("last_idle_since")
    if last_idle_since is None:
        state = _put_state({**state, "status": STATUS_AWAKE, "last_idle_since": now})
        return _public_payload(state, snapshot)

    idle_for = now - _as_int(last_idle_since, now)
    if idle_for >= _idle_seconds():
        _sleep_compute()
        state = _put_state(
            {
                **state,
                "status": STATUS_SLEEPING,
                "last_idle_since": now,
                "wake_started_at": None,
            }
        )
        LOGGER.info("slept stack after %ss idle", idle_for)

    return _public_payload(state, snapshot)


def handle_wake():
    now = int(time.time())
    state = _get_state()
    _start_compute()
    snapshot = _probe()
    if snapshot["ready"]:
        last_idle_since = state.get("last_idle_since")
        if state.get("status") != STATUS_AWAKE:
            last_idle_since = now
        state = _put_state(
            {
                **state,
                "status": STATUS_AWAKE,
                "last_idle_since": last_idle_since,
                "wake_started_at": None,
            }
        )
        return _public_payload(state, snapshot)

    state = _put_state(
        {
            **state,
            "status": STATUS_WAKING,
            "wake_started_at": _as_int(state.get("wake_started_at"), now) or now,
        }
    )
    return _public_payload(state, snapshot)


def _probe():
    ecs_desired, ecs_running = _ecs_counts()
    ec2_state = _ec2_state()
    signaling_http_ok, metrics = _signaling_metrics()
    signaling_tg = _target_group_healthy(os.environ.get("SIGNALING_TARGET_GROUP_NAME"))
    turn_tg_name = os.environ.get("TURN_TARGET_GROUP_NAME") or ""
    turn_tg = (
        _target_group_healthy(turn_tg_name) if turn_tg_name.strip() else True
    )
    busy = False
    if metrics:
        busy = (
            _as_int(metrics.get("connectedClients"), 0) > 0
            or _as_int(metrics.get("activeLobbies"), 0) > 0
            or _as_int(metrics.get("activeGames"), 0) > 0
        )
    ready = (
        ecs_running >= 1
        and ec2_state == "running"
        and signaling_http_ok
        and signaling_tg
        and turn_tg
    )
    return {
        "ecs_desired": ecs_desired,
        "ecs_running": ecs_running,
        "ec2": ec2_state,
        "signaling_http_ok": signaling_http_ok,
        "signaling_tg_healthy": signaling_tg,
        "turn_tg_healthy": turn_tg,
        "busy": busy,
        "ready": ready,
        "metrics": metrics,
    }


def _ecs_counts():
    cluster = os.environ["ECS_CLUSTER"]
    service = os.environ["ECS_SERVICE"]
    try:
        resp = ecs.describe_services(cluster=cluster, services=[service])
        services = resp.get("services") or []
        if not services:
            return 0, 0
        svc = services[0]
        return int(svc.get("desiredCount") or 0), int(svc.get("runningCount") or 0)
    except ClientError as exc:
        LOGGER.warning("describe ecs failed: %s", exc)
        return 0, 0


def _ec2_state():
    instance_id = os.environ["EC2_INSTANCE_ID"]
    try:
        resp = ec2.describe_instances(InstanceIds=[instance_id])
        reservations = resp.get("Reservations") or []
        if not reservations or not reservations[0].get("Instances"):
            return "unknown"
        return reservations[0]["Instances"][0]["State"]["Name"]
    except ClientError as exc:
        LOGGER.warning("describe ec2 failed: %s", exc)
        return "unknown"


def _start_compute():
    cluster = os.environ["ECS_CLUSTER"]
    service = os.environ["ECS_SERVICE"]
    desired = int(os.environ.get("ECS_DESIRED_COUNT") or "1")
    instance_id = os.environ["EC2_INSTANCE_ID"]
    try:
        ecs.update_service(cluster=cluster, service=service, desiredCount=desired)
    except ClientError as exc:
        LOGGER.error("ecs start failed: %s", exc)
        raise
    try:
        ec2.start_instances(InstanceIds=[instance_id])
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code not in (
            "IncorrectInstanceState",
            "IncorrectSpotRequestState",
        ):
            LOGGER.error("ec2 start failed: %s", exc)
            raise
        LOGGER.info("ec2 start skipped: %s", code)


def _sleep_compute():
    cluster = os.environ["ECS_CLUSTER"]
    service = os.environ["ECS_SERVICE"]
    instance_id = os.environ["EC2_INSTANCE_ID"]
    try:
        ecs.update_service(cluster=cluster, service=service, desiredCount=0)
    except ClientError as exc:
        LOGGER.error("ecs sleep failed: %s", exc)
        raise
    try:
        ec2.stop_instances(InstanceIds=[instance_id])
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code != "IncorrectInstanceState":
            LOGGER.error("ec2 stop failed: %s", exc)
            raise
        LOGGER.info("ec2 stop skipped: %s", code)


def _signaling_metrics():
    url = os.environ.get("SIGNALING_HEALTH_URL") or ""
    if not url:
        return False, None
    req = urllib.request.Request(
        url,
        method="GET",
        headers={"Accept": "application/json", "User-Agent": "abstergo-hibernate"},
    )
    try:
        with urllib.request.urlopen(req, timeout=3) as resp:
            if getattr(resp, "status", 200) >= 400:
                return False, None
            raw = resp.read().decode("utf-8")
            payload = json.loads(raw) if raw else {}
            latest = payload.get("latest") if isinstance(payload, dict) else None
            return True, latest if isinstance(latest, dict) else {}
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError) as exc:
        LOGGER.info("signaling health failed: %s", exc)
        return False, None


def _target_group_healthy(name):
    if not name:
        return True
    try:
        groups = elbv2.describe_target_groups(Names=[name]).get("TargetGroups") or []
        if not groups:
            return False
        arn = groups[0]["TargetGroupArn"]
        health = elbv2.describe_target_health(TargetGroupArn=arn).get(
            "TargetHealthDescriptions"
        ) or []
        return any(
            (item.get("TargetHealth") or {}).get("State") == "healthy" for item in health
        )
    except ClientError as exc:
        LOGGER.info("target group %s health failed: %s", name, exc)
        return False


def _get_state():
    table = dynamodb.Table(os.environ["STATE_TABLE"])
    resp = table.get_item(Key={"pk": STATE_PK})
    item = resp.get("Item")
    if not item:
        return {
            "pk": STATE_PK,
            "status": STATUS_SLEEPING,
            "last_idle_since": None,
            "force_awake": False,
            "wake_started_at": None,
        }
    return item


def _put_state(state):
    table = dynamodb.Table(os.environ["STATE_TABLE"])
    item = {
        "pk": STATE_PK,
        "status": state.get("status") or STATUS_SLEEPING,
        "force_awake": bool(state.get("force_awake")),
        "updated_at": int(time.time()),
    }
    if state.get("last_idle_since") is not None:
        item["last_idle_since"] = _as_int(state.get("last_idle_since"))
    if state.get("wake_started_at") is not None:
        item["wake_started_at"] = _as_int(state.get("wake_started_at"))
    table.put_item(Item=item)
    return item


def _reconcile_status(state, snapshot):
    status = state.get("status") or STATUS_SLEEPING
    if snapshot["ready"] and status != STATUS_AWAKE:
        return _put_state(
            {
                **state,
                "status": STATUS_AWAKE,
                "last_idle_since": state.get("last_idle_since") or int(time.time()),
                "wake_started_at": None,
            }
        )
    return state


def _public_payload(state, snapshot):
    return {
        "ready": bool(snapshot.get("ready")),
        "status": state.get("status") or STATUS_SLEEPING,
        "forceAwake": bool(state.get("force_awake")),
        "lastIdleSince": _as_int(state.get("last_idle_since"), None),
        "ecs": {
            "desired": snapshot.get("ecs_desired"),
            "running": snapshot.get("ecs_running"),
        },
        "ec2": snapshot.get("ec2"),
        "signalingHealthy": bool(snapshot.get("signaling_http_ok")),
        "message": _status_message(state.get("status"), snapshot),
    }


def _status_message(status, snapshot):
    if snapshot.get("ready"):
        return "Serveur de jeu pret."
    if status == STATUS_WAKING or snapshot.get("ecs_desired"):
        return "Demarrage du serveur de jeu..."
    return "Serveur de jeu en veille."


def _idle_seconds():
    return max(60, int(os.environ.get("IDLE_SECONDS") or "3600"))


def _as_int(value, default=0):
    if value is None:
        return default
    if isinstance(value, Decimal):
        return int(value)
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _is_tick_event(event):
    if not isinstance(event, dict):
        return False
    if event.get("hibernate_action") == "tick":
        return True
    if event.get("source") == "aws.events":
        return True
    return False


def _is_http_event(event):
    if not isinstance(event, dict):
        return False
    return "http" in (event.get("requestContext") or {})


def _authorized(event):
    expected = os.environ.get("WAKE_TOKEN") or ""
    if not expected:
        return False
    headers = event.get("headers") or {}
    provided = ""
    for key, value in headers.items():
        lowered = key.lower()
        if lowered == "x-wake-token":
            provided = value or ""
            break
        if lowered == "authorization" and (value or "").lower().startswith("bearer "):
            provided = value.split(" ", 1)[1]
            break
    return secrets.compare_digest(provided.strip(), expected)


def _http_response(status_code, body):
    payload = "" if body == "" else json.dumps(body, default=str)
    return {
        "statusCode": status_code,
        "headers": {
            "content-type": "application/json; charset=utf-8",
            "access-control-allow-origin": "*",
            "access-control-allow-headers": "content-type,x-wake-token,authorization",
            "access-control-allow-methods": "GET,POST,OPTIONS",
        },
        "body": payload,
    }
