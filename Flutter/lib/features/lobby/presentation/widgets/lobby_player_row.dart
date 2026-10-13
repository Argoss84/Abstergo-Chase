import 'package:broken_veil_protocol/features/lobby/domain/lobby_models.dart';
import 'package:flutter/material.dart';

class LobbyPlayerRow extends StatelessWidget {
  const LobbyPlayerRow({
    super.key,
    required this.player,
    required this.isSelf,
    required this.voiceActive,
    this.onRoleChanged,
  });

  final LobbyPlayer player;
  final bool isSelf;
  final bool voiceActive;
  final ValueChanged<String?>? onRoleChanged;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final status =
        '${player.isHost ? 'Organisateur' : 'Joueur'}${isSelf ? ' · Vous' : ''}';
    final identity = Row(
      children: [
        Tooltip(
          message: voiceActive
              ? '${player.name} parle'
              : 'Aucune activité vocale',
          child: Semantics(
            label: voiceActive
                ? '${player.name} parle'
                : 'Aucune activité vocale de ${player.name}',
            child: SizedBox.square(
              dimension: 28,
              child: Icon(
                voiceActive ? Icons.graphic_eq : Icons.volume_mute,
                size: 18,
                color: voiceActive ? scheme.primary : scheme.onSurfaceVariant,
              ),
            ),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Tooltip(
                message: player.name,
                child: Text(
                  player.name,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const SizedBox(height: 4),
              Text(
                status,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: scheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ],
    );
    return AnimatedContainer(
      duration: MediaQuery.disableAnimationsOf(context)
          ? Duration.zero
          : const Duration(milliseconds: 180),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 12),
      decoration: BoxDecoration(
        color: voiceActive
            ? scheme.primary.withValues(alpha: 0.10)
            : isSelf
            ? scheme.primary.withValues(alpha: 0.04)
            : Colors.transparent,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: voiceActive ? scheme.primary : Colors.transparent,
        ),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final scale = MediaQuery.textScalerOf(context).scale(1);
          final roleWidth = 136 * scale.clamp(1.0, 1.3);
          final compact =
              scale > 1.3 || constraints.maxWidth - roleWidth - 12 < 122;
          final role = _buildRole(context);
          if (compact) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                identity,
                const SizedBox(height: 8),
                Padding(padding: const EdgeInsets.only(left: 38), child: role),
              ],
            );
          }
          return Row(
            children: [
              Expanded(child: identity),
              const SizedBox(width: 12),
              SizedBox(width: roleWidth, child: role),
            ],
          );
        },
      ),
    );
  }

  Widget _buildRole(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final role = player.role ?? '';
    final color = _roleColor(context, role);
    final editable = onRoleChanged != null;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: role.isEmpty
              ? scheme.outlineVariant
              : color.withValues(alpha: 0.30),
        ),
      ),
      child: Semantics(
        label: 'Rôle de ${player.name}',
        child: editable
            ? DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  value: role,
                  isExpanded: true,
                  borderRadius: BorderRadius.circular(12),
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  icon: Icon(
                    Icons.expand_more,
                    size: 18,
                    color: scheme.onSurfaceVariant,
                  ),
                  style: theme.textTheme.labelLarge?.copyWith(
                    color: scheme.onSurface,
                    fontWeight: FontWeight.w600,
                  ),
                  items: [
                    for (final value in ['', 'AGENT', 'ROGUE'])
                      DropdownMenuItem(
                        value: value,
                        child: _roleContent(context, value),
                      ),
                  ],
                  onChanged: (value) =>
                      onRoleChanged!((value?.isEmpty ?? true) ? null : value),
                ),
              )
            : ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 48),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  child: _roleContent(context, role),
                ),
              ),
      ),
    );
  }

  Widget _roleContent(BuildContext context, String role) {
    final icon = switch (role) {
      'AGENT' => Image.asset(
        'assets/images/agent_marker.png',
        fit: BoxFit.contain,
      ),
      'ROGUE' => Image.asset(
        'assets/images/rogue_marker.png',
        fit: BoxFit.contain,
      ),
      _ => Icon(Icons.help_outline, size: 20, color: _roleColor(context, role)),
    };
    return Row(
      children: [
        ExcludeSemantics(child: SizedBox.square(dimension: 24, child: icon)),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            switch (role) {
              'AGENT' => 'Agent',
              'ROGUE' => 'Rogue',
              _ => onRoleChanged == null ? 'Sans rôle' : 'À choisir',
            },
            style: Theme.of(
              context,
            ).textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w600),
          ),
        ),
      ],
    );
  }

  Color _roleColor(BuildContext context, String role) {
    final scheme = Theme.of(context).colorScheme;
    return switch (role) {
      'AGENT' =>
        scheme.brightness == Brightness.dark
            ? const Color(0xFF81D4FA)
            : const Color(0xFF1565C0),
      'ROGUE' => scheme.secondary,
      _ => scheme.onSurfaceVariant,
    };
  }
}
