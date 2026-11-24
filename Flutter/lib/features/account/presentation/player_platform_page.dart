import 'package:broken_veil_protocol/app/providers.dart';
import 'package:broken_veil_protocol/features/account/data/account_api_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class PlayerPlatformPage extends ConsumerStatefulWidget {
  const PlayerPlatformPage({super.key, required this.section});
  static const routePath = '/player';
  final String section;

  @override
  ConsumerState<PlayerPlatformPage> createState() => _PlayerPlatformPageState();
}

class _PlayerPlatformPageState extends ConsumerState<PlayerPlatformPage> {
  late Future<Map<String, dynamic>> _data;
  final _search = TextEditingController();
  int? _before;

  @override
  void initState() {
    super.initState();
    _data = _load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<Map<String, dynamic>> _request(
    String path, {
    String method = 'GET',
    Map<String, Object?>? body,
    Map<String, String>? query,
  }) async {
    final auth = ref.read(authControllerProvider);
    final token = await auth.getAccessToken();
    if (token == null) {
      throw const SessionInvalidatedException('Reconnecte-toi à ton compte.');
    }
    try {
      return await auth.accountApi.request(
        token,
        path,
        method: method,
        body: body,
        query: query,
      );
    } on SessionInvalidatedException catch (failure) {
      await auth.handleSessionInvalidated(failure.message);
      rethrow;
    }
  }

  Future<Map<String, dynamic>> _load() async {
    switch (widget.section) {
      case 'history':
        return _request(
          '/players/me/history',
          query: {if (_before != null) 'before': _before.toString()},
        );
      case 'friends':
        final name = _search.text.trim();
        final values = await Future.wait([
          _request('/social/friends'),
          if (name.length >= 2)
            _request('/social/search', query: {'q': name})
          else
            _request('/social/recent'),
        ]);
        return {...values.first, ...values.last};
      case 'bonuses':
        final values = await Future.wait([
          _request('/progression/me'),
          _request('/progression/bonuses'),
        ]);
        return {...values.first, ...values.last};
      default:
        return {};
    }
  }

  void _reload() => setState(() => _data = _load());

  Future<void> _mutate(
    String path,
    Map<String, Object?> value, {
    String method = 'POST',
  }) async {
    try {
      await _request(path, method: method, body: value);
      if (mounted) _reload();
    } catch (failure) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(failure.toString())));
      }
    }
  }

  Iterable<Map<String, dynamic>> _rows(Object? items) => (items as List? ?? [])
      .whereType<Map>()
      .map((item) => Map<String, dynamic>.from(item));

  bool _flag(Object? value) => value == true || value == 1;

  String _name(Map row) =>
      (row['display_name'] ??
              row['username'] ??
              row['display_name_snapshot'] ??
              'Agent')
          .toString();

  Future<void> _profile(String id) async {
    final data = _request('/players/$id');
    await showDialog<void>(
      context: context,
      builder: (context) => FutureBuilder<Map<String, dynamic>>(
        future: data,
        builder: (context, snapshot) {
          final player = snapshot.data?['player'] as Map?;
          return AlertDialog(
            title: Text(player == null ? 'Profil joueur' : _name(player)),
            content: snapshot.hasError
                ? const Text('Profil indisponible')
                : player == null
                ? const SizedBox(
                    height: 48,
                    child: Center(child: CircularProgressIndicator()),
                  )
                : player['status'] == 'deleted'
                ? null
                : Text('Niveau ${player['level'] ?? 1}'),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Fermer'),
              ),
            ],
          );
        },
      ),
    );
  }

  List<Widget> _history(Map<String, dynamic> data) {
    final stats = data['stats'] as Map? ?? {};
    final games = _rows(data['games']);
    return [
      Text(
        'Niveau ${stats['level'] ?? 1} · ${stats['wins'] ?? 0} victoires · ${stats['losses'] ?? 0} défaites',
      ),
      if (games.isEmpty)
        const ListTile(title: Text('Aucune manche à afficher')),
      for (final game in games)
        ExpansionTile(
          title: Text('Salon ${game['code']} · Manche ${game['round_number']}'),
          subtitle: Text(
            '${game['status'] == 'cancelled'
                ? 'Annulée'
                : game['player_status'] == 'left'
                ? 'Abandon'
                : _flag(game['is_winner'])
                ? 'Victoire'
                : 'Défaite'} · +${game['reward_xp']} XP · ${(game['duration_seconds'] as num? ?? 0) ~/ 60} min',
          ),
          children: [
            for (final player in _rows(game['players']))
              ListTile(
                title: Text(_name(player)),
                subtitle: Text(player['role']?.toString() ?? ''),
                onTap: () => _profile(player['public_id'].toString()),
              ),
          ],
        ),
      if (data['next_before'] is int)
        TextButton(
          onPressed: () {
            _before = data['next_before'] as int;
            _reload();
          },
          child: const Text('Manches précédentes'),
        ),
      if (_before != null)
        TextButton(
          onPressed: () {
            _before = null;
            _reload();
          },
          child: const Text('Dernières manches'),
        ),
    ];
  }

  List<Widget> _friends(Map<String, dynamic> data) => [
    TextField(
      controller: _search,
      decoration: InputDecoration(
        labelText: 'Rechercher par pseudo',
        suffixIcon: IconButton(
          onPressed: _reload,
          icon: const Icon(Icons.search),
        ),
      ),
      onSubmitted: (_) => _reload(),
    ),
    const SizedBox(height: 12),
    Text(_search.text.trim().length >= 2 ? 'Résultats' : 'Joueurs récents'),
    for (final player in _rows(data['players']))
      ListTile(
        title: Text(_name(player)),
        onTap: () => _profile(player['public_id'].toString()),
        trailing: IconButton(
          tooltip: 'Demander en ami',
          icon: const Icon(Icons.person_add),
          onPressed: () => _mutate('/social/friends/request', {
            'public_id': player['public_id'],
          }),
        ),
      ),
    const SizedBox(height: 12),
    const Text('Amis et demandes'),
    for (final friend in _rows(data['friends']))
      ListTile(
        title: Text(_name(friend)),
        onTap: () => _profile(friend['public_id'].toString()),
        subtitle: Text(friend['status'] == 'pending' ? 'En attente' : 'Ami'),
        trailing: friend['status'] == 'pending' && _flag(friend['incoming'])
            ? Wrap(
                children: [
                  IconButton(
                    tooltip: 'Accepter',
                    icon: const Icon(Icons.check),
                    onPressed: () => _mutate('/social/friends/respond', {
                      'friendship_id': friend['friendship_id'],
                      'accept': true,
                    }),
                  ),
                  IconButton(
                    tooltip: 'Refuser',
                    icon: const Icon(Icons.close),
                    onPressed: () => _mutate('/social/friends/respond', {
                      'friendship_id': friend['friendship_id'],
                      'accept': false,
                    }),
                  ),
                ],
              )
            : IconButton(
                tooltip: 'Supprimer',
                icon: const Icon(Icons.person_remove),
                onPressed: () => _mutate(
                  '/social/friends/${friend['friendship_id']}',
                  {},
                  method: 'DELETE',
                ),
              ),
      ),
  ];

  List<Widget> _bonuses(Map<String, dynamic> data) {
    final stats = data['stats'] as Map? ?? {};
    return [
      Text('Niveau ${stats['level'] ?? 1} · ${stats['xp'] ?? 0} XP'),
      if (_rows(data['bonuses']).isEmpty)
        const ListTile(title: Text('Aucun bonus disponible')),
      for (final bonus in _rows(data['bonuses']))
        SwitchListTile(
          title: Text(bonus['label'].toString()),
          subtitle: Text(
            [
              'Niveau ${bonus['minimum_level']}',
              if (bonus['allowed_role'] != null)
                bonus['allowed_role'].toString(),
              if (bonus['remaining_charges'] != null)
                '${bonus['remaining_charges']} charges',
              if (bonus['description'] != null) bonus['description'].toString(),
            ].join(' · '),
          ),
          value: _flag(bonus['equipped']),
          onChanged: _flag(bonus['unlocked'])
              ? (value) => _mutate('/progression/bonuses/${bonus['id']}', {
                  'equipped': value,
                }, method: 'PUT')
              : null,
        ),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final title = switch (widget.section) {
      'history' => 'Mes parties',
      'friends' => 'Amis',
      'bonuses' => 'Progression et bonus',
      _ => 'Abonnement',
    };
    final billing = ref.watch(playBillingProvider);
    return Scaffold(
      appBar: AppBar(
        title: Text(title),
        actions: [
          IconButton(
            tooltip: 'Actualiser',
            icon: const Icon(Icons.refresh),
            onPressed: widget.section == 'premium' ? billing.refresh : _reload,
          ),
        ],
      ),
      body: widget.section == 'premium'
          ? ListenableBuilder(
              listenable: billing,
              builder: (context, _) => ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  ListTile(
                    title: Text(
                      billing.adFree
                          ? 'Abonnement actif'
                          : 'Offre gratuite avec publicités',
                    ),
                  ),
                  if (billing.status?['daily_round_limit'] != null)
                    ListTile(
                      title: Text(
                        'Manches hébergées par jour · ${billing.status!['daily_round_limit']}',
                      ),
                    ),
                  if (billing.error != null)
                    ListTile(title: Text(billing.error!)),
                  if (billing.product != null && !billing.adFree)
                    FilledButton(
                      onPressed: billing.busy ? null : billing.subscribe,
                      child: Text(
                        'Voir l’abonnement · ${billing.product!.price}',
                      ),
                    ),
                  if (billing.supportsPurchases)
                    OutlinedButton(
                      onPressed: billing.busy ? null : billing.restore,
                      child: const Text('Restaurer mes achats'),
                    ),
                ],
              ),
            )
          : FutureBuilder<Map<String, dynamic>>(
              future: _data,
              builder: (context, snapshot) {
                if (snapshot.hasError) {
                  return Center(child: Text(snapshot.error.toString()));
                }
                final data = snapshot.data;
                if (data == null) {
                  return const Center(child: CircularProgressIndicator());
                }
                return ListView(
                  padding: const EdgeInsets.all(20),
                  children: switch (widget.section) {
                    'history' => _history(data),
                    'friends' => _friends(data),
                    _ => _bonuses(data),
                  },
                );
              },
            ),
    );
  }
}
