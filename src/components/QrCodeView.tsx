/**
 * QR code rendered as a grid of Views from the pure-JS `qrcode` package's
 * module matrix — no native SVG dependency (a new native module would
 * force another APK consideration; this is JS-only by design).
 */
import { create } from 'qrcode';
import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

export function QrCodeView({
  value,
  size = 220,
  darkColor = '#000000',
  lightColor = '#FFFFFF',
  accessibilityLabel,
}: {
  value: string;
  size?: number;
  darkColor?: string;
  lightColor?: string;
  accessibilityLabel?: string;
}) {
  const modules = useMemo(() => {
    try {
      const qr = create(value, { errorCorrectionLevel: 'M' });
      return { size: qr.modules.size, data: qr.modules.data };
    } catch {
      return null;
    }
  }, [value]);

  if (!modules) return null;
  const cell = size / modules.size;
  const rows: React.ReactNode[] = [];
  for (let y = 0; y < modules.size; y++) {
    const cells: React.ReactNode[] = [];
    for (let x = 0; x < modules.size; x++) {
      const dark = modules.data[y * modules.size + x] === 1;
      cells.push(
        <View
          key={x}
          style={{ width: cell, height: cell, backgroundColor: dark ? darkColor : lightColor }}
        />,
      );
    }
    rows.push(
      <View key={y} style={styles.row}>
        {cells}
      </View>,
    );
  }

  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel ?? value}
      style={[styles.wrap, { width: size, height: size, backgroundColor: lightColor }]}
    >
      {rows}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'center', padding: 0 },
  row: { flexDirection: 'row' },
});
