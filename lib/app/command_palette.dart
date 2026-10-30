import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../providers/auth_controller.dart';
import '../shared/widgets/app_card.dart';
import '../shared/widgets/dialogs.dart';
import '../theme/tokens.dart';
import 'app_actions.dart';
import 'nav_items.dart';

/// One line of the command palette.
class _PaletteEntry {
  const _PaletteEntry({
    required this.label,
    required this.icon,
    required this.group,
    required this.run,
    this.keywords = const <String>[],
  });

  final String label;
  final IconData icon;
  final String group;
  final List<String> keywords;

  /// Runs after the palette has closed.
  final VoidCallback run;

  bool matches(String query) {
    final String needle = query.trim().toLowerCase();
    if (needle.isEmpty) return true;
    if (label.toLowerCase().contains(needle)) return true;
    for (final String word in keywords) {
      if (word.toLowerCase().contains(needle)) return true;
    }
    return false;
  }
}

/// Ctrl+K: jump to any section or run a common action. [context] must belong to a long-lived widget (the app shell),
/// because the actions run after the palette itself has closed.
Future<void> showCommandPalette(BuildContext context) {
  final GoRouter router = GoRouter.of(context);
  final ProviderContainer container = ProviderScope.containerOf(context);
  final bool admin = container.read(isAdminProvider);
  final List<_PaletteEntry> entries = <_PaletteEntry>[];
  for (final NavItem item in <NavItem>[...kNavItems, if (admin) kAdminNavItem]) {
    entries.add(_PaletteEntry(
      label: item.label,
      icon: item.icon,
      group: 'Go to',
      keywords: item.keywords,
      run: () => router.go(item.path),
    ));
  }
  entries.add(_PaletteEntry(
    label: 'Switch between light and dark theme',
    icon: Icons.brightness_6_outlined,
    group: 'Actions',
    keywords: const <String>['theme', 'dark', 'light', 'appearance'],
    run: () => toggleThemeMode(context, container),
  ));
  entries.add(_PaletteEntry(
    label: 'Lock iKeepZ',
    icon: Icons.lock_outline,
    group: 'Actions',
    keywords: const <String>['lock', 'secure', 'privacy'],
    run: () => lockApp(container),
  ));
  entries.add(_PaletteEntry(
    label: 'Sign out',
    icon: Icons.logout,
    group: 'Actions',
    keywords: const <String>['log out', 'logout', 'exit'],
    run: () => confirmAndSignOut(context, container),
  ));
  return showAppModal<void>(
    context,
    title: 'Jump to',
    maxWidth: 560,
    builder: (BuildContext dialogContext) => _PaletteBody(entries: entries),
  );
}

class _PaletteBody extends StatefulWidget {
  const _PaletteBody({required this.entries});

  final List<_PaletteEntry> entries;

  @override
  State<_PaletteBody> createState() => _PaletteBodyState();
}

class _PaletteBodyState extends State<_PaletteBody> {
  final TextEditingController _query = TextEditingController();
  int _selected = 0;

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  void _choose(_PaletteEntry entry) {
    Navigator.of(context).pop();
    entry.run();
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event, List<_PaletteEntry> visible) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) return KeyEventResult.ignored;
    if (visible.isEmpty) return KeyEventResult.ignored;
    if (event.logicalKey == LogicalKeyboardKey.arrowDown) {
      setState(() {
        _selected = (_selected + 1) % visible.length;
      });
      return KeyEventResult.handled;
    }
    if (event.logicalKey == LogicalKeyboardKey.arrowUp) {
      setState(() {
        _selected = (_selected - 1 + visible.length) % visible.length;
      });
      return KeyEventResult.handled;
    }
    if (event.logicalKey == LogicalKeyboardKey.enter || event.logicalKey == LogicalKeyboardKey.numpadEnter) {
      final int index = _selected < visible.length ? _selected : 0;
      _choose(visible[index]);
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    final AppTokens tokens = context.tokens;
    final List<_PaletteEntry> visible = widget.entries.where((_PaletteEntry e) => e.matches(_query.text)).toList();
    final int selected = visible.isEmpty ? 0 : (_selected < visible.length ? _selected : 0);
    final List<Widget> rows = <Widget>[];
    String lastGroup = '';
    for (int i = 0; i < visible.length; i++) {
      final _PaletteEntry entry = visible[i];
      if (entry.group != lastGroup) {
        lastGroup = entry.group;
        rows.add(Padding(
          padding: EdgeInsets.only(top: rows.isEmpty ? 0 : 12, bottom: 4, left: 4),
          child: MicroLabel(entry.group),
        ));
      }
      final bool active = i == selected;
      rows.add(Material(
        color: active ? tokens.selected : Colors.transparent,
        borderRadius: BorderRadius.circular(kControlRadius),
        child: InkWell(
          borderRadius: BorderRadius.circular(kControlRadius),
          onTap: () => _choose(entry),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
            child: Row(
              children: <Widget>[
                Icon(entry.icon, size: 19, color: active ? tokens.primary : tokens.muted),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    entry.label,
                    style: monoStyle(size: 13, weight: active ? FontWeight.w700 : FontWeight.w500, color: tokens.text),
                  ),
                ),
              ],
            ),
          ),
        ),
      ));
    }
    return Focus(
      onKeyEvent: (FocusNode node, KeyEvent event) => _onKey(node, event, visible),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          TextField(
            controller: _query,
            autofocus: true,
            textInputAction: TextInputAction.search,
            onChanged: (String value) => setState(() {
              _selected = 0;
            }),
            decoration: const InputDecoration(
              hintText: 'Search sections and actions…',
              prefixIcon: Icon(Icons.search),
            ),
          ),
          const SizedBox(height: 14),
          if (rows.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 24),
              child: Text('Nothing matches "${_query.text.trim()}".', textAlign: TextAlign.center, style: TextStyle(color: tokens.muted)),
            )
          else
            ...rows,
        ],
      ),
    );
  }
}
