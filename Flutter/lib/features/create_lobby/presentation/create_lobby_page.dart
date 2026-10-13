import 'dart:async';

import 'package:broken_veil_protocol/app/providers.dart';
import 'package:broken_veil_protocol/shared/widgets/app_page_body.dart';
import 'package:broken_veil_protocol/features/account/presentation/account_page.dart';
import 'package:broken_veil_protocol/features/account/data/account_api_service.dart';
import 'package:broken_veil_protocol/features/auth/application/cognito_auth_controller.dart';
import 'package:broken_veil_protocol/features/create_lobby/application/create_lobby_controller.dart';
import 'package:broken_veil_protocol/features/create_lobby/presentation/widgets/create_lobby_details_sheet.dart';
import 'package:broken_veil_protocol/features/create_lobby/presentation/widgets/create_lobby_map.dart';
import 'package:broken_veil_protocol/features/lobby/data/player_session_store.dart';
import 'package:broken_veil_protocol/features/lobby/domain/lobby_models.dart';
import 'package:broken_veil_protocol/features/lobby/presentation/lobby_page.dart';
import 'package:broken_veil_protocol/shared/services/socket_environment_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

class CreateLobbyPage extends ConsumerStatefulWidget {
  const CreateLobbyPage({super.key, this.controllerFactory});

  final CreateLobbyController Function()? controllerFactory;

  static const String routePath = '/create-lobby';
  static const String routeName = 'create-lobby';

  @override
  ConsumerState<CreateLobbyPage> createState() => _CreateLobbyPageState();
}

class _CreateLobbyPageState extends ConsumerState<CreateLobbyPage> {
  late final CreateLobbyController _controller;
  final AccountApiService _accountApiService = AccountApiService();
  final PlayerSessionStore _playerSessionStore = PlayerSessionStore();
  final SocketEnvironmentService _socketEnvironmentService =
      SocketEnvironmentService();
  bool _isLoadingAccountUsername = true;
  int _step = 0;
  final ScrollController _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _controller = widget.controllerFactory?.call() ?? CreateLobbyController();
    _controller.loadCurrentPosition();
    _loadAccountUsername();
    _restoreSocketEnvironment();
  }

  @override
  void dispose() {
    _scrollController.dispose();
    _controller.dispose();
    super.dispose();
  }

  Future<void> _openDetailsSheet() async {
    final data = await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (_) => CreateLobbyDetailsSheet(initialData: _controller.form),
    );

    if (!mounted) return;
    if (data is CreateLobbyDetailsResult) {
      final terrainChanged = data.form.mapRadius != _controller.form.mapRadius;
      _controller.updateForm(data.form);
      final center = _controller.selectedPosition;
      if (terrainChanged && center != null) {
        _controller.setSelectedPosition(center);
      }
    }
  }

  Future<void> _loadAccountUsername() async {
    if (!mounted) {
      return;
    }
    final auth = ref.read(authControllerProvider);
    final fallbackUsername = auth.username?.trim() ?? '';
    _controller.setDisplayName(fallbackUsername);
    _controller.lastError = null;
    setState(() {
      _isLoadingAccountUsername = false;
    });
    unawaited(_refreshAccountUsernameFromApi(auth));
  }

  Future<void> _refreshAccountUsernameFromApi(
    CognitoAuthController auth,
  ) async {
    try {
      final token = await auth.getAccessToken();
      if (token == null || token.isEmpty) {
        return;
      }
      await _accountApiService.syncUser(token, username: auth.username);
      final profile = await _accountApiService.getMyProfile(token);
      final username = profile.username?.trim() ?? auth.username?.trim() ?? '';
      final cognitoSub = await auth.getCurrentUserSub();
      if (!mounted) return;
      _controller.cognitoSub = cognitoSub;
      if (username.isNotEmpty) {
        _controller.setDisplayName(username);
      }
      _controller.lastError = null;
    } catch (error) {
      if (error is SessionInvalidatedException) {
        await ref
            .read(authControllerProvider)
            .handleSessionInvalidated(error.message);
      }
    }
  }

  Future<void> _restoreSocketEnvironment() async {
    final config = await _socketEnvironmentService.loadConfig();
    if (!mounted) return;
    _controller.setServerUrl(config.serverUrl);
    _controller.setSocketPath(config.socketPath);
  }

  void _goToStep(int step) {
    setState(() => _step = step);
    if (_scrollController.hasClients) _scrollController.jumpTo(0);
  }

  Future<void> _createLobby() async {
    if (!_controller.canCreateLobby) return;
    final router = GoRouter.of(context);
    final messenger = ScaffoldMessenger.of(context);
    await _controller.createLobby();
    if (!mounted) return;
    final code = _controller.createdLobbyCode;
    if (code == null) {
      if (_controller.lastError != null) {
        messenger.showSnackBar(SnackBar(content: Text(_controller.lastError!)));
      }
      return;
    }
    await _playerSessionStore.saveLastLobbyCode(code);
    if (!mounted) return;
    final bootstrap = LobbyBootstrapData(
      code: code,
      serverUrl: _controller.serverUrl,
      socketPath: _controller.socketPath,
      playerName: _controller.displayName.trim(),
      cognitoSub: _controller.cognitoSub,
      previousPlayerId: _controller.createdLobbySession?.playerId,
      reconnectAsHost: true,
      form: _controller.form,
      objectives: _controller.objectives,
      agentStartZone: _controller.agentStartZone,
      rogueStartZone: _controller.rogueStartZone,
      outerStreetContour: _controller.outerStreetContour,
    );
    _controller.releaseSignalingSocket();
    router.go('${LobbyPage.routePath}?code=$code', extra: bootstrap);
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        final canContinue =
            !_controller.isSubmitting &&
            (_step == 0
                ? !_isLoadingAccountUsername &&
                      _controller.displayName.isNotEmpty
                : _controller.hasCompleteMapConfiguration &&
                      !_controller.isLoadingStreets);
        return PopScope(
          canPop: _step == 0 && !_controller.isSubmitting,
          onPopInvokedWithResult: (didPop, result) {
            if (!didPop && !_controller.isSubmitting && _step > 0) {
              _goToStep(_step - 1);
            }
          },
          child: Scaffold(
            appBar: AppBar(
              title: const Text('Créer une partie'),
              leading: BackButton(
                onPressed: _controller.isSubmitting
                    ? null
                    : () {
                        if (_step > 0) {
                          _goToStep(_step - 1);
                        } else if (context.canPop()) {
                          context.pop();
                        } else {
                          context.go('/');
                        }
                      },
              ),
            ),
            body: AppPageBody(
              child: ListView(
                controller: _scrollController,
                padding: const EdgeInsets.all(20),
                children: [
                  _buildProgress(),
                  const SizedBox(height: 24),
                  if (_step == 0) _buildSettings(),
                  if (_step == 1) _buildTerrain(),
                  if (_step == 2) _buildReview(),
                  if (_controller.lastError != null) ...[
                    const SizedBox(height: 16),
                    AppNotice(message: _controller.lastError!, isError: true),
                  ],
                  const SizedBox(height: 24),
                ],
              ),
            ),
            bottomNavigationBar: SafeArea(
              top: false,
              child: AppPageBody(
                shrinkWrap: true,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
                  child: Row(
                    children: [
                      if (_step > 0) ...[
                        IconButton(
                          tooltip: 'Étape précédente',
                          onPressed: _controller.isSubmitting
                              ? null
                              : () => _goToStep(_step - 1),
                          icon: const Icon(Icons.arrow_back),
                        ),
                        const SizedBox(width: 12),
                      ],
                      Expanded(
                        child: FilledButton.icon(
                          onPressed: _step == 2
                              ? (_controller.canCreateLobby
                                    ? _createLobby
                                    : null)
                              : (canContinue
                                    ? () => _goToStep(_step + 1)
                                    : null),
                          icon: _controller.isSubmitting
                              ? const SizedBox(
                                  width: 18,
                                  height: 18,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : Icon(
                                  _step == 2
                                      ? Icons.check
                                      : Icons.arrow_forward,
                                ),
                          label: Text(
                            _controller.isSubmitting
                                ? 'Connexion au serveur…'
                                : _step == 2
                                ? 'Créer la partie'
                                : 'Continuer',
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _buildProgress() {
    const labels = ['Réglages', 'Terrain', 'Validation'];
    final scheme = Theme.of(context).colorScheme;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: List.generate(3, (index) {
        final current = index == _step;
        final completed = index < _step;
        final canTap = index <= _step && !_controller.isSubmitting;
        return Expanded(
          child: Padding(
            padding: EdgeInsets.only(right: index < 2 ? 8 : 0),
            child: Semantics(
              label: 'Étape ${index + 1} sur 3 : ${labels[index]}',
              button: true,
              enabled: canTap,
              selected: current,
              child: Material(
                color: current ? scheme.primaryContainer : Colors.transparent,
                borderRadius: BorderRadius.circular(12),
                child: InkWell(
                  borderRadius: BorderRadius.circular(12),
                  onTap: canTap ? () => _goToStep(index) : null,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 4,
                      vertical: 10,
                    ),
                    child: ExcludeSemantics(
                      child: Column(
                        children: [
                          Container(
                            width: 28,
                            height: 28,
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: current || completed
                                  ? scheme.primary
                                  : scheme.surfaceContainerHighest,
                            ),
                            child: completed
                                ? Icon(
                                    Icons.check,
                                    size: 18,
                                    color: scheme.onPrimary,
                                  )
                                : Text(
                                    '${index + 1}',
                                    style: TextStyle(
                                      fontWeight: FontWeight.w700,
                                      color: current
                                          ? scheme.onPrimary
                                          : scheme.onSurfaceVariant,
                                    ),
                                  ),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            labels[index],
                            textAlign: TextAlign.center,
                            style: Theme.of(context).textTheme.labelMedium
                                ?.copyWith(
                                  fontWeight: current
                                      ? FontWeight.w700
                                      : FontWeight.w500,
                                  color: current
                                      ? scheme.onPrimaryContainer
                                      : scheme.onSurfaceVariant,
                                ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
      }),
    );
  }

  String _durationLabel(int seconds) {
    final minutes = seconds ~/ 60;
    final remainder = seconds % 60;
    if (minutes == 0) return '$remainder s';
    return remainder == 0 ? '$minutes min' : '$minutes min $remainder s';
  }

  String _hackLabel(int milliseconds) =>
      '${(milliseconds / 1000).toStringAsFixed(3).replaceFirst(RegExp(r'\.?0+$'), '').replaceAll('.', ',')} s';

  Widget _buildSettings() {
    final form = _controller.form;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const AppSectionHeading(
          title: 'Définissez les règles',
          subtitle: 'Choisissez vos règles, puis préparez le terrain.',
        ),
        const SizedBox(height: 20),
        if (_isLoadingAccountUsername)
          const LinearProgressIndicator()
        else if (_controller.displayName.isEmpty)
          AppNotice(
            message:
                'Définissez votre nom de joueur dans Mon compte pour continuer.',
            isError: true,
            action: TextButton(
              onPressed: () async {
                await context.push(AccountPage.routePath);
                if (mounted) await _loadAccountUsername();
              },
              child: const Text('Mon compte'),
            ),
          )
        else
          Row(
            children: [
              const Icon(Icons.person_outline),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _controller.displayName,
                      style: Theme.of(context).textTheme.titleSmall,
                    ),
                    Text(
                      'Organisateur de la partie',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        const SizedBox(height: 20),
        Card(
          margin: EdgeInsets.zero,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                LayoutBuilder(
                  builder: (context, constraints) {
                    final columns =
                        constraints.maxWidth >= 280 &&
                            MediaQuery.textScalerOf(context).scale(1) <= 1.3
                        ? 2
                        : 1;
                    final width =
                        (constraints.maxWidth - (columns - 1) * 12) / columns;
                    final items = [
                      _ruleStat(
                        Icons.timer_outlined,
                        'Durée',
                        _durationLabel(form.duration),
                      ),
                      _ruleStat(
                        Icons.flag_outlined,
                        'Objectifs',
                        '${form.objectiveNumber} sur le terrain',
                        detail:
                            '${form.victoryConditionObjectives} pour gagner',
                      ),
                      _ruleStat(
                        Icons.radar,
                        'Rayon du terrain',
                        '${form.mapRadius} m',
                      ),
                      _ruleStat(
                        Icons.bolt_outlined,
                        'Durée du hack',
                        _hackLabel(form.hackDurationMs),
                      ),
                    ];
                    return Wrap(
                      spacing: 12,
                      runSpacing: 12,
                      children: items
                          .map((item) => SizedBox(width: width, child: item))
                          .toList(),
                    );
                  },
                ),
                const SizedBox(height: 16),
                OutlinedButton.icon(
                  onPressed: _openDetailsSheet,
                  icon: const Icon(Icons.tune),
                  label: const Text('Modifier les paramètres'),
                ),
              ],
            ),
          ),
        ),
        if (_controller.objectives.isNotEmpty) ...[
          const SizedBox(height: 12),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                Icons.info_outline,
                size: 18,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Changer le nombre d’objectifs ou le rayon du terrain nécessite de replacer les points.',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
            ],
          ),
        ],
      ],
    );
  }

  Widget _ruleStat(
    IconData icon,
    String label,
    String value, {
    String? detail,
  }) {
    final scheme = Theme.of(context).colorScheme;
    final compact =
        MediaQuery.sizeOf(context).width < 360 ||
        MediaQuery.textScalerOf(context).scale(1) > 1.3;
    final description = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: Theme.of(
            context,
          ).textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
        ),
        const SizedBox(height: 4),
        Text(
          value,
          style: Theme.of(
            context,
          ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
        ),
        if (detail != null) ...[
          const SizedBox(height: 4),
          Text(
            detail,
            style: Theme.of(
              context,
            ).textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
          ),
        ],
      ],
    );
    return Container(
      padding: const EdgeInsets.all(12),
      constraints: BoxConstraints(minHeight: compact ? 0 : 122),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(12),
      ),
      child: compact
          ? Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(icon, size: 20, color: scheme.primary),
                const SizedBox(width: 12),
                Expanded(child: description),
              ],
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(icon, size: 20, color: scheme.primary),
                const SizedBox(height: 10),
                description,
              ],
            ),
    );
  }

  Widget _buildTerrain() {
    final canPlace =
        _controller.selectedPosition != null &&
        !_controller.isLoadingStreets &&
        _controller.streets.any((street) => street.length >= 2);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const AppSectionHeading(
          title: 'Préparez le terrain',
          subtitle:
              'Touchez la carte pour choisir le centre, puis générez ou placez les points de jeu.',
        ),
        const SizedBox(height: 20),
        if (_controller.isLoadingGps)
          const SizedBox(
            height: 300,
            child: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  CircularProgressIndicator(),
                  SizedBox(height: 12),
                  Text('Recherche de votre position…'),
                ],
              ),
            ),
          )
        else if (_controller.currentPosition != null)
          RepaintBoundary(
            child: CreateLobbyMap(
              currentPosition: _controller.currentPosition!,
              selectedPosition: _controller.selectedPosition,
              mapRadiusMeters: _controller.form.mapRadius,
              startZoneRadiusMeters: _controller.form.startZoneRadius,
              objectiveZoneRadiusMeters: _controller.form.objectiveZoneRadius,
              streets: _controller.streets,
              outerStreetContour: _controller.outerStreetContour,
              objectives: _controller.objectives,
              agentStartZone: _controller.agentStartZone,
              rogueStartZone: _controller.rogueStartZone,
              onTap: _controller.handleMapTap,
            ),
          )
        else
          AppNotice(
            message:
                'Position GPS indisponible. Vérifiez la localisation et réessayez.',
            isError: true,
            action: TextButton(
              onPressed: _controller.loadCurrentPosition,
              child: const Text('Réessayer'),
            ),
          ),
        const SizedBox(height: 16),
        if (_controller.isLoadingStreets) ...[
          const LinearProgressIndicator(),
          const SizedBox(height: 8),
          const Text('Chargement des rues accessibles…'),
        ],
        if (_controller.streetsLoadError != null)
          AppNotice(
            message: _controller.streetsLoadError!,
            isError: true,
            action: TextButton(
              onPressed: _controller.fetchStreets,
              child: const Text('Réessayer le chargement'),
            ),
          ),
        const SizedBox(height: 12),
        FilledButton.tonalIcon(
          onPressed: canPlace ? _controller.generateObjectives : null,
          icon: const Icon(Icons.auto_awesome_outlined),
          label: const Text('Générer les objectifs'),
        ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: canPlace ? _controller.beginManualPlacement : null,
          icon: const Icon(Icons.edit_location_alt_outlined),
          label: Text(
            _controller.isManualPlacement
                ? 'Recommencer le placement'
                : 'Placer à la main',
          ),
        ),
        if (_controller.manualPlacementInstruction != null) ...[
          const SizedBox(height: 16),
          AppNotice(message: _controller.manualPlacementInstruction!),
        ],
        const SizedBox(height: 16),
        _summary(
          'Objectifs placés',
          '${_controller.objectives.length} / ${_controller.form.objectiveNumber}',
        ),
        _summary(
          'Départ Agents',
          _controller.agentStartZone != null ? 'Prêt' : 'À placer',
        ),
        _summary(
          'Départ Rogues',
          _controller.rogueStartZone != null ? 'Prêt' : 'À placer',
        ),
      ],
    );
  }

  Widget _buildReview() {
    final form = _controller.form;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const AppSectionHeading(
          title: 'Tout est prêt ?',
          subtitle:
              'Vérifiez la configuration. La création ouvrira le lobby pour inviter votre équipe.',
        ),
        const SizedBox(height: 20),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                _summary('Organisateur', _controller.displayName),
                _summary('Durée', _durationLabel(form.duration)),
                _summary(
                  'Objectifs',
                  '${_controller.objectives.length} · ${form.victoryConditionObjectives} pour gagner',
                ),
                _summary('Rayon du terrain', '${form.mapRadius} m'),
                _summary('Zones de départ', 'Agents et Rogues configurés'),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: _controller.isSubmitting
                      ? null
                      : () => _goToStep(1),
                  icon: const Icon(Icons.map_outlined),
                  label: const Text('Revoir le terrain'),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _summary(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: LayoutBuilder(
        builder: (context, constraints) {
          if (constraints.maxWidth < 360 ||
              MediaQuery.textScalerOf(context).scale(1) > 1.3) {
            return SizedBox(
              width: double.infinity,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    value,
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                ],
              ),
            );
          }
          return Row(
            children: [
              Expanded(
                child: Text(
                  label,
                  style: TextStyle(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
              const SizedBox(width: 16),
              Flexible(
                child: Text(
                  value,
                  textAlign: TextAlign.end,
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
