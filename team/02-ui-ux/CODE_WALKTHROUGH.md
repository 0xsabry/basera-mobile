# 02 — Code Walkthrough: UI/UX

## 1. كل الشاشات مبنية من نفس القطع — `src/components/ui.tsx`

مفيش شاشة بترسم كارت أو زرار بنفسها. الـ `Card` مثلًا بياخد ألوانه من
الثيم الحالي وحدوده من الـ tokens:

```tsx
export function Card({ /* ... */ }) {
  const { colors } = useSettings();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor,
          borderWidth: tone ? 2 : 1,
          elevation: raised ? elevation.raised : elevation.flat,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
```

## 2. كبسولات الحالة لازم تكون قصيرة — `StatusPill`

الـ pill معمول لكلمة أو كلمتين (On / Off / تنبيه). درس اتعلمناه من
الجهاز: لما مررنا جملة كاملة كـ label، الكبسولة اتمددت وخنقت النص اللي
جنبها. الإصلاح خلى مفاتيح مخصوصة قصيرة في `src/i18n/strings.ts`:
`statusPillOn` / `statusPillOff` / `statusPillIssue`.

```tsx
export function StatusPill({ tone, label, glyph }) {
  const tc = toneColors(colors, tone);
  return (
    <View accessible accessibilityLabel={label}
      style={[styles.pill, { backgroundColor: tc.soft, borderColor: tc.solid }]}>
      <Text>{glyph ?? TONE_GLYPHS[tone]}</Text>
      <Text style={{ fontWeight: '700', flexShrink: 1, textAlign: 'center' }}>{label}</Text>
    </View>
  );
}
```

## 3. الثيم والاتجاه — `src/state/SettingsContext.tsx`

```ts
export type ThemePreference = 'light' | 'dark' | 'system';
export function resolveIsDark(pref: ThemePreference, systemDark: boolean): boolean;
export function colorsFor(isDark: boolean, highContrast: boolean): ThemeColors;
export function applyLayoutDirection(lang: AppLanguage): void;
```

- الثيم الافتراضي لتركيب جديد: فاتح (light).
- `applyLayoutDirection` بيظبط RTL لما اللغة عربي.
- التباين العالي (high contrast) وضع منفصل له ألوانه، ومتحقق منه باختبار
  تباين آلي `src/theme/__tests__/contrast.test.ts`.

## 4. اللغة محروسة باختبارات — `src/i18n/__tests__/copy.test.ts`

- نفس المفاتيح بالضبط في العربي والإنجليزي (key parity).
- ممنوع مصطلحات عامية ولا «مش» لوحدها في واجهة العربي — الواجهة فصحى.
- حدود طول لعناوين الأزرار والشروحات عشان الشاشة متتحولش لمقال.

## 5. قواعد ثابتة في كل الشاشات

- أهداف لمس لا تقل عن 48dp، والمحتوى بعرض أقصى 600dp في المنتصف.
- كل عنصر تفاعلي له accessibility label، والنتائج بتتقال بصوت/ live region
  مش بس بتظهر.
- التطبيق مبيتكلمش من نفسه عند الفتح (محروس باختبار `noEntrySpeech`).
