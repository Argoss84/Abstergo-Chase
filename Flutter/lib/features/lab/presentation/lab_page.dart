import 'package:flutter/material.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

class LabPage extends StatefulWidget {
  const LabPage({super.key});

  static const String routeName = 'lab';
  static const String routePath = '/lab';

  @override
  State<LabPage> createState() => _LabPageState();
}

class _LabPageState extends State<LabPage> {
  final TextEditingController _urlController = TextEditingController(
    text: 'http://10.0.2.2:5174',
  );
  final TextEditingController _pathController = TextEditingController(
    text: '/socket.io',
  );
  final TextEditingController _messageController = TextEditingController();
  final List<String> _events = <String>[];

  io.Socket? _socket;
  bool _isConnected = false;

  @override
  void dispose() {
    _disconnect(silent: true);
    _urlController.dispose();
    _pathController.dispose();
    _messageController.dispose();
    super.dispose();
  }

  void _connect() {
    final rawUrl = _urlController.text.trim();
    if (rawUrl.isEmpty) {
      _appendEvent('Veuillez renseigner une URL serveur.');
      return;
    }

    final path = _pathController.text.trim().isEmpty
        ? '/socket.io'
        : _pathController.text.trim();

    final uri = Uri.tryParse(rawUrl.replaceAll(RegExp(r'/$'), ''));
    if (uri == null || (uri.scheme != 'http' && uri.scheme != 'https')) {
      _appendEvent('URL invalide. Utilisez http:// ou https://');
      return;
    }

    _disconnect(silent: true);

    final socket = io.io(
      uri.toString(),
      io.OptionBuilder()
          .setPath(path)
          .setTransports(<String>['websocket'])
          .disableAutoConnect()
          .build(),
    );

    socket.onConnect((_) {
      if (!mounted) {
        return;
      }
      setState(() {
        _isConnected = true;
      });
      _appendEvent('Connecte a ${uri.toString()} (path: $path)');
    });

    socket.onDisconnect((reason) {
      _appendEvent('Connexion fermee: $reason');
      _markDisconnected();
    });

    socket.onConnectError((error) {
      _appendEvent('Erreur connexion: $error');
      _markDisconnected();
    });

    socket.onError((error) {
      _appendEvent('Erreur socket: $error');
    });

    socket.on('message', (data) {
      _appendEvent('RECV(message): $data');
    });

    socket.onAny((event, data) {
      if (event == 'message') {
        return;
      }
      _appendEvent('RECV($event): $data');
    });

    _socket = socket;
    socket.connect();
  }

  void _disconnect({bool silent = false}) {
    final socket = _socket;
    _socket = null;
    socket?.dispose();

    if (_isConnected) {
      setState(() {
        _isConnected = false;
      });
      if (!silent) {
        _appendEvent('Deconnecte.');
      }
    }
  }

  void _sendMessage() {
    final message = _messageController.text.trim();
    final socket = _socket;
    if (!_isConnected || socket == null) {
      _appendEvent('Connexion requise avant envoi.');
      return;
    }
    if (message.isEmpty) {
      _appendEvent('Message vide ignore.');
      return;
    }
    socket.emit('message', message);
    _appendEvent('SEND: $message');
    _messageController.clear();
  }

  void _appendEvent(String event) {
    if (!mounted) {
      return;
    }
    setState(() {
      _events.insert(0, '${DateTime.now().toIso8601String()} | $event');
    });
  }

  void _markDisconnected() {
    if (!mounted) {
      return;
    }
    setState(() {
      _isConnected = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Lab'),
      ),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            const Text(
              'Lab Page',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _urlController,
              keyboardType: TextInputType.url,
              decoration: const InputDecoration(
                border: OutlineInputBorder(),
                labelText: 'WebSocket URL',
                hintText: 'http://10.0.2.2:5174',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _pathController,
              decoration: const InputDecoration(
                border: OutlineInputBorder(),
                labelText: 'Socket.IO path',
                hintText: '/socket.io',
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: ElevatedButton(
                    onPressed: _isConnected ? null : _connect,
                    child: const Text('Connecter'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton(
                    onPressed: _isConnected ? _disconnect : null,
                    child: const Text('Deconnecter'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _messageController,
              decoration: const InputDecoration(
                border: OutlineInputBorder(),
                labelText: 'Message',
              ),
              onSubmitted: (_) => _sendMessage(),
            ),
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton(
                onPressed: _isConnected ? _sendMessage : null,
                child: const Text('Envoyer'),
              ),
            ),
            const SizedBox(height: 12),
            Expanded(
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  border: Border.all(color: Theme.of(context).dividerColor),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: _events.isEmpty
                    ? const Center(child: Text('Aucun message'))
                    : ListView.builder(
                        itemCount: _events.length,
                        itemBuilder: (context, index) {
                          return Padding(
                            padding: const EdgeInsets.symmetric(vertical: 2),
                            child: Text(_events[index]),
                          );
                        },
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
