import 'package:flutter/material.dart';

class AppTheme {
  const AppTheme._();

  static ThemeData light() {
    return _buildCyberpunkTheme(brightness: Brightness.light);
  }

  static ThemeData dark() {
    return _buildCyberpunkTheme(brightness: Brightness.dark);
  }

  static ThemeData _buildCyberpunkTheme({required Brightness brightness}) {
    final isDark = brightness == Brightness.dark;

    const neonCyan = Color(0xFF00F5FF);
    const neonMagenta = Color(0xFFFF2BD6);
    const neonPurple = Color(0xFF8A2BFF);
    const midnight = Color(0xFF060814);
    const elevated = Color(0xFF0F1530);
    const lightBg = Color(0xFFE8F7FF);

    final colorScheme = ColorScheme(
      brightness: brightness,
      primary: isDark ? neonCyan : neonPurple,
      onPrimary: isDark ? midnight : Colors.white,
      secondary: neonMagenta,
      onSecondary: Colors.white,
      error: const Color(0xFFFF4D6D),
      onError: Colors.white,
      background: isDark ? midnight : lightBg,
      onBackground: isDark ? const Color(0xFFDDFBFF) : const Color(0xFF0A1024),
      surface: isDark ? elevated : Colors.white,
      onSurface: isDark ? const Color(0xFFDDFBFF) : const Color(0xFF0A1024),
    );

    final base = ThemeData(
      colorScheme: colorScheme,
      useMaterial3: true,
      brightness: brightness,
      scaffoldBackgroundColor: colorScheme.background,
      cardColor: colorScheme.surface,
      dividerColor: colorScheme.primary.withOpacity(0.22),
      appBarTheme: AppBarTheme(
        backgroundColor: colorScheme.surface.withOpacity(isDark ? 0.86 : 0.92),
        foregroundColor: colorScheme.onSurface,
        elevation: 0,
        centerTitle: true,
        titleTextStyle: TextStyle(
          color: colorScheme.onSurface,
          fontWeight: FontWeight.w800,
          fontSize: 20,
          letterSpacing: 0.8,
          shadows: [
            Shadow(
              color: colorScheme.secondary.withOpacity(0.35),
              blurRadius: 10,
            ),
          ],
        ),
      ),
      textTheme: ThemeData(brightness: brightness).textTheme.apply(
            bodyColor: colorScheme.onBackground,
            displayColor: colorScheme.onBackground,
          ),
      iconTheme: IconThemeData(color: colorScheme.primary),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: colorScheme.primary,
          foregroundColor: colorScheme.onPrimary,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          elevation: 0,
          shadowColor: colorScheme.secondary.withOpacity(0.55),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: colorScheme.primary,
          foregroundColor: colorScheme.onPrimary,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          shadowColor: colorScheme.secondary.withOpacity(0.55),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: colorScheme.primary,
          side: BorderSide(color: colorScheme.primary.withOpacity(0.85), width: 1.2),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        ),
      ),
      cardTheme: CardTheme(
        color: colorScheme.surface.withOpacity(isDark ? 0.9 : 0.98),
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(color: colorScheme.primary.withOpacity(0.28), width: 1),
        ),
        shadowColor: colorScheme.secondary.withOpacity(0.28),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: colorScheme.surface.withOpacity(isDark ? 0.72 : 0.95),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: colorScheme.primary.withOpacity(0.35)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: colorScheme.primary.withOpacity(0.35)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: colorScheme.secondary, width: 1.4),
        ),
        labelStyle: TextStyle(color: colorScheme.primary.withOpacity(0.95)),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: colorScheme.surface.withOpacity(isDark ? 0.74 : 0.94),
        selectedColor: colorScheme.primary.withOpacity(0.26),
        side: BorderSide(color: colorScheme.primary.withOpacity(0.35)),
        labelStyle: TextStyle(color: colorScheme.onSurface),
      ),
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: colorScheme.secondary,
        foregroundColor: colorScheme.onSecondary,
        elevation: 0,
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: colorScheme.secondary,
        linearTrackColor: colorScheme.primary.withOpacity(0.2),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: colorScheme.surface.withOpacity(0.96),
        contentTextStyle: TextStyle(color: colorScheme.onSurface),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(color: colorScheme.primary.withOpacity(0.32)),
        ),
      ),
    );

    return base.copyWith(
      shadowColor: colorScheme.secondary.withOpacity(0.32),
    );
  }
}
