# 09 — Code Walkthrough: History & Settings

## 1. مخزن السجل — `src/data/HistoryStore.ts`

```ts
export const MAX_HISTORY_ITEMS = 50;

export class HistoryStore {
  async list(): Promise<HistoryItem[]> {
    try {
      const raw = await this.storage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as HistoryItem[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async add(item: Omit<HistoryItem, 'id' | 'timestamp'>): Promise<HistoryItem> {
    const full = { ...item, id: `h-${Date.now()}-…`, timestamp: Date.now() };
    const items = [full, ...(await this.list())].slice(0, MAX_HISTORY_ITEMS);
    await this.storage.setItem(STORAGE_KEY, JSON.stringify(items));
    return full;
  }
}
```

- الأحدث الأول، والسقف 50 عنصر — أقدم حاجة بتتطرد تلقائيًا.
- القراءة فاسدة؟ بترجع قائمة فاضية بدل ما التطبيق يقع.
- والصورة نفسها بتتنسخ لتخزين التطبيق الخاص بـ `persistImageCopy()`
  لأن ملفات المنتقي المؤقتة بتتمسح.

## 2. نموذج الإعدادات — `src/state/SettingsContext.tsx`

```ts
export interface Settings { /* language, theme, contrast, announcements,
                              voicePreference, sharing flags */ }
export const DEFAULT_SETTINGS: Settings = { /* ... */ };
export function parseSettings(raw: string | null): Settings;
export function migrateVoicePreference(parsed: { /* legacy shapes */ });
export function useSettings(): SettingsContextValue;
```

- مصدر واحد للإعدادات، وكل الشاشات بتقرأ من `useSettings()`.
- `parseSettings` بيصلح أي شكل قديم أو فاسد ويرجعه لافتراضي آمن.
- وترحيل تفضيل الصوت (`migrateVoicePreference`) بيحوّل القيم القديمة
  المخزنة لشكل `VoicePreference` الحالي من غير ما المستخدم يفقد
  اختياره.

## 3. تدفق تغيير اللغة

تغيير اللغة من الإعدادات → حفظ → `applyLayoutDirection()` بيقلب RTL →
إعادة تشغيل آمنة للواجهة (`languageRestart.ts`) → كل النصوص من جدول
`STRINGS` باللغة الجديدة. مفيش نصوص مكتوبة بره الجدول — فيه اختبار
آلي بيسقط أي نص صلب في الواجهة.
