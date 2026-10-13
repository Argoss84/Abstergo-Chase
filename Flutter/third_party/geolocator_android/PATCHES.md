# Local Android GPS fix

Runtime sources copied from the published `geolocator_android` 5.0.2 package. Its
license, version, Dart API, Android dependencies and SDK settings are retained.
The example application and upstream test tooling are omitted.

## NMEA cleanup ANR

On emulator-5556 (Android 14 / API 34), the ANR trace shows the main thread blocked
in `ILocationManager.unregisterGnssNmeaCallback`, called by `NmeaClient.stop()`
after a one-shot position fix. This matches
[upstream issue #1795](https://github.com/Baseflow/flutter-geolocator/issues/1795).

`NmeaClient.start()` now registers the optional NMEA/GNSS listeners only when
`useMSLAltitude` is explicitly requested. `stop()` returns immediately when those
listeners were never registered. The app uses latitude and longitude and does
not request MSL altitude or read satellite counters. Standard position fixes,
permissions and position streams keep using the existing provider.

For callers that explicitly request MSL altitude, the upstream behavior remains;
this patch does not claim to fix that path. Optional satellite counters remain
at zero when NMEA listeners are not requested.

The app selects this package through `dependency_overrides` in its pubspec,
making the correction reproducible without changing the shared Pub cache. Remove
the override and local package once an upstream release fixes the ANR and has
been verified with the app's existing Android compatibility.
