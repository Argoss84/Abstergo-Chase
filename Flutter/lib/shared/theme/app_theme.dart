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

    final colorScheme =
        ColorScheme.fromSeed(
          seedColor: neonPurple,
          brightness: brightness,
        ).copyWith(
          brightness: brightness,
          primary: isDark ? neonCyan : const Color(0xFF6825C7),
          onPrimary: isDark ? midnight : Colors.white,
          secondary: isDark ? neonMagenta : const Color(0xFF9A167F),
          onSecondary: isDark ? midnight : Colors.white,
          surface: isDark ? elevated : const Color(0xFFF8F7FC),
          onSurface: isDark ? const Color(0xFFE8EEF9) : const Color(0xFF182037),
          onSurfaceVariant: isDark
              ? const Color(0xFFB8C3DA)
              : const Color(0xFF505B73),
          outlineVariant: isDark
              ? const Color(0xFF35415A)
              : const Color(0xFFD8DCE8),
        );

    final base = ThemeData(
      colorScheme: colorScheme,
      useMaterial3: true,
      brightness: brightness,
      scaffoldBackgroundColor: isDark ? midnight : const Color(0xFFF1F3F9),
      visualDensity: VisualDensity.standard,
      materialTapTargetSize: MaterialTapTargetSize.padded,
      cardColor: colorScheme.surface,
      dividerColor: colorScheme.primary.withValues(alpha: 0.22),
      appBarTheme: AppBarTheme(
        backgroundColor: colorScheme.surface,
        surfaceTintColor: Colors.transparent,
        scrolledUnderElevation: 0,
        foregroundColor: colorScheme.onSurface,
        elevation: 0,
        centerTitle: false,
        titleTextStyle: ThemeData(brightness: brightness).textTheme.titleLarge
            ?.copyWith(
              color: colorScheme.onSurface,
              fontWeight: FontWeight.w800,
              fontSize: 20,
            ),
      ),
      textTheme: ThemeData(brightness: brightness).textTheme.apply(
        bodyColor: colorScheme.onSurface,
        displayColor: colorScheme.onSurface,
      ),
      iconTheme: IconThemeData(color: colorScheme.primary),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          minimumSize: const Size(48, 48),
          backgroundColor: colorScheme.primary,
          foregroundColor: colorScheme.onPrimary,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
          elevation: 0,
          shadowColor: colorScheme.secondary.withValues(alpha: 0.55),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(48, 48),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
          shadowColor: colorScheme.secondary.withValues(alpha: 0.55),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(48, 48),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
          foregroundColor: colorScheme.primary,
          side: BorderSide(
            color: colorScheme.primary.withValues(alpha: 0.85),
            width: 1.2,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
        ),
      ),
      cardTheme: CardThemeData(
        color: colorScheme.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(color: colorScheme.outlineVariant, width: 1),
        ),
        shadowColor: colorScheme.secondary.withValues(alpha: 0.28),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: colorScheme.surface,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 16,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: colorScheme.outlineVariant),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: colorScheme.outlineVariant),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: colorScheme.primary, width: 2),
        ),
        labelStyle: ThemeData(
          brightness: brightness,
        ).textTheme.bodyLarge?.copyWith(color: colorScheme.onSurfaceVariant),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: colorScheme.surface.withValues(
          alpha: isDark ? 0.74 : 0.94,
        ),
        selectedColor: colorScheme.primary.withValues(alpha: 0.26),
        side: BorderSide(color: colorScheme.primary.withValues(alpha: 0.35)),
        labelStyle: ThemeData(
          brightness: brightness,
        ).textTheme.labelLarge?.copyWith(color: colorScheme.onSurface),
      ),
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: colorScheme.primaryContainer,
        foregroundColor: colorScheme.onPrimaryContainer,
        elevation: 0,
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: colorScheme.secondary,
        linearTrackColor: colorScheme.primary.withValues(alpha: 0.2),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: colorScheme.surface.withValues(alpha: 0.96),
        contentTextStyle: TextStyle(color: colorScheme.onSurface),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(color: colorScheme.primary.withValues(alpha: 0.32)),
        ),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: colorScheme.surface,
        surfaceTintColor: Colors.transparent,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        clipBehavior: Clip.antiAlias,
      ),
    );

    return base.copyWith(
      shadowColor: colorScheme.secondary.withValues(alpha: 0.32),
    );
  }
}
