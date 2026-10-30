import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../models/user_profile.dart';
import '../providers/auth_controller.dart';
import '../providers/data_providers.dart';
import '../services/auth_service.dart';
import '../shared/layout.dart';
import '../shared/widgets/app_card.dart';
import '../shared/widgets/visuals.dart';
import '../theme/tokens.dart';
import 'app_actions.dart';
import 'command_palette.dart';
import 'nav_items.dart';

/// The frame around every signed-in page: a sidebar and top bar on wide windows, a drawer, app bar and bottom
/// bar on phones.
class AppShell extends ConsumerStatefulWidget {
  const AppShell({super.key, required this.location, required this.child});

  final String location;
  final Widget child;

  @override
  ConsumerState<AppShell> createState() => _AppShellState();
}

class _AppShellState extends ConsumerState<AppShell> {
  final GlobalKey<ScaffoldState> _scaffoldKey = GlobalKey<ScaffoldState>();

  void _openPalette() {
    showCommandPalette(context);
  }

  @override
  Widget build(BuildContext context) {
    final AppTokens tokens = context.tokens;
    final bool admin = ref.watch(isAdminProvider);
    final List<NavItem> items = <NavItem>[...kNavItems, if (admin) kAdminNavItem];
    final NavItem? current = navItemFor(widget.location, includeAdmin: admin);
    final String title = current?.label ?? 'iKeepZ';
    final bool wide = isWideLayout(context);

    final Widget frame;
    if (wide) {
      frame = Scaffold(
        key: _scaffoldKey,
        body: Row(
          children: <Widget>[
            SizedBox(width: 232, child: AppSidebar(location: widget.location, items: items)),
            Container(width: 1, color: tokens.border),
            Expanded(
              child: Column(
                children: <Widget>[
                  _TopBar(title: title, onSearch: _openPalette),
                  Container(height: 1, color: tokens.border),
                  Expanded(child: widget.child),
                ],
              ),
            ),
          ],
        ),
      );
    } else {
      int selectedIndex = kBottomBarPaths.length;
      for (int i = 0; i < kBottomBarPaths.length; i++) {
        if (widget.location == kBottomBarPaths[i] || widget.location.startsWith('${kBottomBarPaths[i]}/')) selectedIndex = i;
      }
      frame = Scaffold(
        key: _scaffoldKey,
        appBar: AppBar(
          backgroundColor: tokens.surface,
          surfaceTintColor: Colors.transparent,
          elevation: 0,
          scrolledUnderElevation: 0,
          shape: Border(bottom: BorderSide(color: tokens.border)),
          title: Text(title, style: monoStyle(size: 16, weight: FontWeight.w700, color: tokens.text)),
          actions: <Widget>[
            IconButton(tooltip: 'Search', icon: const Icon(Icons.search), onPressed: _openPalette),
            const _BellButton(),
          ],
        ),
        drawer: Drawer(
          width: 290,
          child: AppSidebar(
            location: widget.location,
            items: items,
            onNavigate: () => _scaffoldKey.currentState?.closeDrawer(),
          ),
        ),
        body: widget.child,
        bottomNavigationBar: NavigationBar(
          backgroundColor: tokens.surface,
          surfaceTintColor: Colors.transparent,
          selectedIndex: selectedIndex,
          onDestinationSelected: (int index) {
            if (index >= kBottomBarPaths.length) {
              _scaffoldKey.currentState?.openDrawer();
            } else {
              context.go(kBottomBarPaths[index]);
            }
          },
          destinations: <Widget>[
            for (final String path in kBottomBarPaths) _bottomDestination(path),
            const NavigationDestination(icon: Icon(Icons.menu), label: 'More'),
          ],
        ),
      );
    }

    return CallbackShortcuts(
      bindings: <ShortcutActivator, VoidCallback>{
        const SingleActivator(LogicalKeyboardKey.keyK, control: true): _openPalette,
        const SingleActivator(LogicalKeyboardKey.keyK, meta: true): _openPalette,
      },
      child: Focus(autofocus: true, child: frame),
    );
  }

  Widget _bottomDestination(String path) {
    final NavItem? item = navItemFor(path, includeAdmin: false);
    return NavigationDestination(
      icon: Icon(item?.icon ?? Icons.circle_outlined),
      label: item?.label ?? path,
    );
  }
}

/// The sidebar (also the content of the phone drawer).
class AppSidebar extends ConsumerWidget {
  const AppSidebar({super.key, required this.location, required this.items, this.onNavigate});

  final String location;
  final List<NavItem> items;

  /// Called before navigating (the drawer closes itself with it).
  final VoidCallback? onNavigate;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppTokens tokens = context.tokens;
    final int unread = ref.watch(unreadCountProvider);
    final List<Widget> children = <Widget>[];
    String lastGroup = '';
    for (final NavItem item in items) {
      if (item.group != lastGroup) {
        lastGroup = item.group;
        children.add(Padding(
          padding: EdgeInsets.fromLTRB(12, children.isEmpty ? 4 : 18, 12, 6),
          child: MicroLabel(item.group),
        ));
      }
      children.add(_SidebarItem(
        item: item,
        selected: item.matches(location),
        badge: item.path == '/notifications' ? unread : 0,
        onTap: () {
          onNavigate?.call();
          context.go(item.path);
        },
      ));
    }
    return Container(
      color: tokens.surface,
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 18, 18, 10),
              child: Row(
                children: <Widget>[
                  const BrandMark(size: 30),
                  const SizedBox(width: 10),
                  Text('iKeepZ', style: monoStyle(size: 20, weight: FontWeight.w700, color: tokens.text)),
                ],
              ),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(10, 4, 10, 12),
                children: children,
              ),
            ),
            Container(height: 1, color: tokens.border),
            _UserTile(onNavigate: onNavigate),
          ],
        ),
      ),
    );
  }
}

class _SidebarItem extends StatelessWidget {
  const _SidebarItem({required this.item, required this.selected, required this.badge, required this.onTap});

  final NavItem item;
  final bool selected;
  final int badge;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final AppTokens tokens = context.tokens;
    final Color foreground = selected ? tokens.primary : tokens.muted;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 1),
      child: Semantics(
        selected: selected,
        button: true,
        label: item.label,
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            borderRadius: BorderRadius.circular(kControlRadius),
            onTap: onTap,
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 150),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: selected ? tokens.selected : Colors.transparent,
                borderRadius: BorderRadius.circular(kControlRadius),
              ),
              child: Row(
                children: <Widget>[
                  Icon(item.icon, size: 19, color: foreground),
                  const SizedBox(width: 11),
                  Expanded(
                    child: Text(
                      item.label,
                      overflow: TextOverflow.ellipsis,
                      style: monoStyle(size: 13, weight: selected ? FontWeight.w700 : FontWeight.w500, color: selected ? tokens.text : tokens.muted),
                    ),
                  ),
                  if (badge > 0)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                      decoration: BoxDecoration(color: tokens.primary, borderRadius: BorderRadius.circular(999)),
                      child: Text(
                        badge > 99 ? '99+' : '$badge',
                        style: monoStyle(size: 10.5, weight: FontWeight.w700, color: tokens.onPrimary),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _UserTile extends ConsumerWidget {
  const _UserTile({this.onNavigate});

  final VoidCallback? onNavigate;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppTokens tokens = context.tokens;
    final UserProfile? profile = ref.watch(profileProvider).value;
    final AuthUser? user = ref.watch(authControllerProvider).user;
    final String name = profile?.displayName ?? user?.displayName ?? 'iKeepZ user';
    final String email = profile?.email ?? user?.email ?? '';
    return PopupMenuButton<String>(
      tooltip: 'Account menu',
      offset: const Offset(0, -150),
      onSelected: (String value) {
        final ProviderContainer container = ProviderScope.containerOf(context);
        if (value == 'profile') {
          onNavigate?.call();
          context.go('/profile');
        } else if (value == 'lock') {
          onNavigate?.call();
          lockApp(container);
        } else if (value == 'signout') {
          onNavigate?.call();
          confirmAndSignOut(context, container);
        }
      },
      itemBuilder: (BuildContext context) => <PopupMenuEntry<String>>[
        const PopupMenuItem<String>(
          value: 'profile',
          child: ListTile(leading: Icon(Icons.person_outline), title: Text('Profile'), contentPadding: EdgeInsets.zero, dense: true),
        ),
        const PopupMenuItem<String>(
          value: 'lock',
          child: ListTile(leading: Icon(Icons.lock_outline), title: Text('Lock iKeepZ'), contentPadding: EdgeInsets.zero, dense: true),
        ),
        const PopupMenuItem<String>(
          value: 'signout',
          child: ListTile(leading: Icon(Icons.logout), title: Text('Sign out'), contentPadding: EdgeInsets.zero, dense: true),
        ),
      ],
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
        child: Row(
          children: <Widget>[
            UserAvatar(initials: initialsOf(name), photoUrl: profile?.photoUrl, size: 36),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: monoStyle(size: 12.5, weight: FontWeight.w700, color: tokens.text)),
                  if (email.isNotEmpty) Text(email, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 11.5, color: tokens.muted)),
                ],
              ),
            ),
            Icon(Icons.unfold_more, size: 18, color: tokens.muted),
          ],
        ),
      ),
    );
  }
}

class _TopBar extends ConsumerWidget {
  const _TopBar({required this.title, required this.onSearch});

  final String title;
  final VoidCallback onSearch;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppTokens tokens = context.tokens;
    final bool dark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      height: 60,
      color: tokens.surface,
      padding: const EdgeInsets.symmetric(horizontal: 22),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: monoStyle(size: 17, weight: FontWeight.w700, color: tokens.text)),
          ),
          InkWell(
            borderRadius: BorderRadius.circular(kControlRadius),
            onTap: onSearch,
            child: Container(
              width: 280,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
              decoration: BoxDecoration(color: tokens.fill, borderRadius: BorderRadius.circular(kControlRadius)),
              child: Row(
                children: <Widget>[
                  Icon(Icons.search, size: 18, color: tokens.muted),
                  const SizedBox(width: 8),
                  Expanded(child: Text('Search or jump to…', style: TextStyle(color: tokens.muted, fontSize: 13))),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: tokens.surface,
                      borderRadius: BorderRadius.circular(5),
                      border: Border.all(color: tokens.border),
                    ),
                    child: Text('Ctrl K', style: monoStyle(size: 10.5, color: tokens.muted)),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(width: 8),
          IconButton(
            tooltip: dark ? 'Switch to the light theme' : 'Switch to the dark theme',
            icon: Icon(dark ? Icons.light_mode_outlined : Icons.dark_mode_outlined),
            onPressed: () => toggleThemeMode(context, ProviderScope.containerOf(context)),
          ),
          const _BellButton(),
        ],
      ),
    );
  }
}

class _BellButton extends ConsumerWidget {
  const _BellButton();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final int unread = ref.watch(unreadCountProvider);
    return IconButton(
      tooltip: unread > 0 ? '$unread unread notifications' : 'Notifications',
      icon: Badge(
        isLabelVisible: unread > 0,
        label: Text(unread > 99 ? '99+' : '$unread'),
        child: const Icon(Icons.notifications_none),
      ),
      onPressed: () => context.go('/notifications'),
    );
  }
}
