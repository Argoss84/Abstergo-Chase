class GeoPoint {
  const GeoPoint({required this.latitude, required this.longitude});

  final double latitude;
  final double longitude;

  bool get isValid =>
      latitude.isFinite &&
      longitude.isFinite &&
      latitude.abs() <= 90 &&
      longitude.abs() <= 180;

  static GeoPoint? tryParse(Object? latitude, Object? longitude) {
    final lat = double.tryParse(latitude?.toString() ?? '');
    final lng = double.tryParse(longitude?.toString() ?? '');
    if (lat == null || lng == null) return null;
    final point = GeoPoint(latitude: lat, longitude: lng);
    return point.isValid ? point : null;
  }
}
