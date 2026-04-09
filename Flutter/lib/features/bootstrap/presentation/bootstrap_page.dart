import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:abstergo_chase/features/lab/presentation/lab_page.dart';

class BootstrapPage extends StatelessWidget {
  const BootstrapPage({super.key});

  static const String routeName = 'bootstrap';
  static const String routePath = '/';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('AbstergoChase'),
      ),
      drawer: Drawer(
        child: SafeArea(
          child: ListView(
            children: [
              const DrawerHeader(
                child: Align(
                  alignment: Alignment.bottomLeft,
                  child: Text(
                    'AbstergoChase',
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
                  ),
                ),
              ),
              ListTile(
                leading: const Icon(Icons.science_outlined),
                title: const Text('Lab Page'),
                onTap: () {
                  Navigator.of(context).pop();
                  context.push(LabPage.routePath);
                },
              ),
            ],
          ),
        ),
      ),
      body: const Center(
        child: Text('Bootstrap screen'),
      ),
    );
  }
}
