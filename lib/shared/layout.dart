import 'package:flutter/material.dart';

/// Width at which the permanent sidebar appears.
const double kWideBreakpoint = 900;

/// Width below which the phone layout (bottom navigation, full-screen dialogs) is used.
const double kNarrowBreakpoint = 600;

bool isWideLayout(BuildContext context) => MediaQuery.sizeOf(context).width >= kWideBreakpoint;

bool isNarrowLayout(BuildContext context) => MediaQuery.sizeOf(context).width < kNarrowBreakpoint;

/// Horizontal page padding that grows with the window.
double pagePadding(BuildContext context) {
  final double width = MediaQuery.sizeOf(context).width;
  if (width >= kWideBreakpoint) return 28;
  if (width >= kNarrowBreakpoint) return 20;
  return 14;
}

/// Centres page content and limits its width on very wide windows.
class PageBody extends StatelessWidget {
  const PageBody({super.key, required this.child, this.maxWidth = 1180});

  final Widget child;
  final double maxWidth;

  @override
  Widget build(BuildContext context) {
    final double padding = pagePadding(context);
    return Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth),
        child: Padding(padding: EdgeInsets.symmetric(horizontal: padding), child: child),
      ),
    );
  }
}

/// A scrollable page: header, then [children], with the standard padding.
class PageScroll extends StatelessWidget {
  const PageScroll({super.key, required this.children, this.maxWidth = 1180, this.controller});

  final List<Widget> children;
  final double maxWidth;
  final ScrollController? controller;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      controller: controller,
      padding: const EdgeInsets.only(top: 22, bottom: 40),
      child: PageBody(
        maxWidth: maxWidth,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
      ),
    );
  }
}

/// Lays [children] out in a responsive grid with [columns] on wide screens, [mediumColumns] on medium ones, one on phones.
class ResponsiveGrid extends StatelessWidget {
  const ResponsiveGrid({
    super.key,
    required this.children,
    this.columns = 3,
    this.mediumColumns = 2,
    this.spacing = 14,
  });

  final List<Widget> children;
  final int columns;
  final int mediumColumns;
  final double spacing;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final double width = constraints.maxWidth;
        int count = columns;
        if (width < 560) {
          count = 1;
        } else if (width < 860) {
          count = mediumColumns < columns ? mediumColumns : columns;
        }
        if (count < 1) count = 1;
        final double itemWidth = (width - spacing * (count - 1)) / count;
        return Wrap(
          spacing: spacing,
          runSpacing: spacing,
          children: <Widget>[
            for (final Widget child in children) SizedBox(width: itemWidth, child: child),
          ],
        );
      },
    );
  }
}
