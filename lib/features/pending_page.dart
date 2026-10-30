import 'package:flutter/material.dart';

import '../shared/layout.dart';
import '../shared/widgets/page_header.dart';
import '../shared/widgets/states.dart';

/// Temporary body of a section whose screen has not been built yet. Removed once every section exists.
class PendingSectionPage extends StatelessWidget {
  const PendingSectionPage({super.key, required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return PageScroll(
      children: <Widget>[
        PageHeader(title: title, subtitle: 'This section is still being built.'),
        const SizedBox(
          height: 280,
          child: EmptyState(
            icon: Icons.construction_outlined,
            title: 'Coming in the next update',
            message: 'This part of the app is not finished yet, so there is nothing to show here.',
          ),
        ),
      ],
    );
  }
}
