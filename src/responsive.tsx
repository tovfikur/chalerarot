import React, { ReactNode } from 'react';
import { View, useWindowDimensions } from 'react-native';

// Breakpoints shared by the whole app. Do not scatter width checks in screens.
export const BP_TABLET = 768;
export const BP_DESKTOP = 1200;
export const CONTENT_MAX = 1120;
export const GRID_GAP = 10;

export function useBreakpoint() {
  const { width } = useWindowDimensions();
  const isMobile = width < BP_TABLET;
  const isTablet = width >= BP_TABLET && width < BP_DESKTOP;
  const isDesktop = width >= BP_DESKTOP;
  return { width, isMobile, isTablet, isDesktop };
}

export function useColumns(mobile = 1, tablet = 2, desktop = 3) {
  const { isMobile, isTablet } = useBreakpoint();
  return isMobile ? mobile : isTablet ? tablet : desktop;
}

export function contentPadding(width: number) {
  return width >= BP_DESKTOP ? 24 : width >= BP_TABLET ? 20 : 14;
}

// Shared desktop typography scale. Mobile/tablet keep the first value,
// desktop (>= 1200px) uses the second. No zoom/scale transforms.
export function useFs(mobile: number, desktop: number) {
  const { isDesktop } = useBreakpoint();
  return isDesktop ? desktop : mobile;
}

// Responsive multi-column grid. No horizontal scrolling: items share 100% width.
export function RGrid({
  children,
  mobile = 1,
  tablet = 2,
  desktop = 3,
  gap = GRID_GAP,
}: {
  children: ReactNode;
  mobile?: number;
  tablet?: number;
  desktop?: number;
  gap?: number;
}) {
  const cols = useColumns(mobile, tablet, desktop);
  const items = React.Children.toArray(children);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -gap / 2 }}>
      {items.map((c, i) => (
        <View key={i} style={{ width: `${100 / cols}%`, paddingHorizontal: gap / 2 }}>
          {c}
        </View>
      ))}
    </View>
  );
}

// Two panels side-by-side on wide screens, stacked on narrow ones.
export function TwoPanel({
  left,
  right,
  breakpoint = BP_TABLET,
  leftFlex = 3,
  rightFlex = 2,
  gap = 12,
}: {
  left: ReactNode;
  right: ReactNode;
  breakpoint?: number;
  leftFlex?: number;
  rightFlex?: number;
  gap?: number;
}) {
  const { width } = useWindowDimensions();
  const side = width >= breakpoint;
  return (
    <View style={{ flexDirection: side ? 'row' : 'column', gap, alignItems: side ? 'flex-start' : 'stretch' }}>
      <View style={side ? { flex: leftFlex } : undefined}>{left}</View>
      <View style={side ? { flex: rightFlex } : undefined}>{right}</View>
    </View>
  );
}

// Single column on mobile, clean 2 columns on desktop.
export function FormGrid({ children }: { children: ReactNode }) {
  return (
    <RGrid mobile={1} tablet={1} desktop={2}>
      {children}
    </RGrid>
  );
}
