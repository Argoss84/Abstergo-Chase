import 'package:broken_veil_protocol/features/lobby/domain/lobby_models.dart';
import 'package:flutter/material.dart';

class LobbyStartRequirements extends StatelessWidget {
  const LobbyStartRequirements({super.key, required this.players});

  final List<LobbyPlayer> players;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final assigned = players
        .where((p) => (p.role ?? '').trim().isNotEmpty)
        .length;
    final agents = players
        .where((p) => p.role?.toUpperCase() == 'AGENT')
        .length;
    final rogues = players
        .where((p) => p.role?.toUpperCase() == 'ROGUE')
        .length;
    final allAssigned = players.isNotEmpty && assigned == players.length;
    final completed = [
      allAssigned,
      agents > 0,
      rogues > 0,
    ].where((v) => v).length;
    final ready = completed == 3;
    return Semantics(
      liveRegion: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Prérequis pour démarrer',
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      ready
                          ? 'Tout est prêt pour jouer'
                          : 'Complétez les rôles de votre équipe',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: ready ? scheme.primary : scheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Semantics(
                label: '$completed conditions remplies sur 3',
                child: ExcludeSemantics(
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 6,
                    ),
                    decoration: BoxDecoration(
                      color: ready
                          ? scheme.primaryContainer
                          : scheme.surfaceContainerHigh,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      '$completed / 3',
                      style: theme.textTheme.labelLarge?.copyWith(
                        color: ready
                            ? scheme.onPrimaryContainer
                            : scheme.onSurfaceVariant,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            decoration: BoxDecoration(
              color: scheme.surfaceContainerLow,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Column(
              children: [
                _condition(
                  context,
                  title: 'Rôles attribués',
                  detail: '$assigned sur ${players.length} joueurs',
                  satisfied: allAssigned,
                  icon: Icon(
                    Icons.groups_outlined,
                    size: 24,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
                Divider(height: 1, color: scheme.outlineVariant),
                _condition(
                  context,
                  title: 'Au moins un Agent',
                  detail: '$agents joueur${agents > 1 ? 's' : ''}',
                  satisfied: agents > 0,
                  icon: Image.asset(
                    'assets/images/agent_marker.png',
                    fit: BoxFit.contain,
                  ),
                ),
                Divider(height: 1, color: scheme.outlineVariant),
                _condition(
                  context,
                  title: 'Au moins un Rogue',
                  detail: '$rogues joueur${rogues > 1 ? 's' : ''}',
                  satisfied: rogues > 0,
                  icon: Image.asset(
                    'assets/images/rogue_marker.png',
                    fit: BoxFit.contain,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _condition(
    BuildContext context, {
    required String title,
    required String detail,
    required bool satisfied,
    required Widget icon,
  }) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Semantics(
      label: '$title : ${satisfied ? 'validé' : 'à compléter'}. $detail.',
      child: ExcludeSemantics(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Row(
            children: [
              SizedBox.square(dimension: 24, child: icon),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      detail,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              Icon(
                satisfied ? Icons.check_circle : Icons.radio_button_unchecked,
                size: 22,
                color: satisfied ? scheme.primary : scheme.outline,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
