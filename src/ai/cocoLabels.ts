/** COCO-80 class labels in English and Arabic (MSA, Egyptian-friendly). */
export const COCO_LABELS_EN: string[] = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck',
  'boat', 'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench',
  'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra',
  'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee',
  'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove',
  'skateboard', 'surfboard', 'tennis racket', 'bottle', 'wine glass', 'cup',
  'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich', 'orange',
  'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch',
  'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse',
  'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink',
  'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear',
  'hair drier', 'toothbrush',
];

export const COCO_LABELS_AR: string[] = [
  'شخص', 'دراجة', 'سيارة', 'دراجة نارية', 'طائرة', 'حافلة', 'قطار', 'شاحنة',
  'قارب', 'إشارة مرور', 'صنبور إطفاء', 'علامة توقف', 'عداد موقف', 'مقعد',
  'طائر', 'قطة', 'كلب', 'حصان', 'خروف', 'بقرة', 'فيل', 'دب', 'حمار وحشي',
  'زرافة', 'حقيبة ظهر', 'مظلة', 'حقيبة يد', 'ربطة عنق', 'حقيبة سفر', 'قرص طائر',
  'زلاجات', 'لوح تزلج على الثلج', 'كرة رياضية', 'طائرة ورقية', 'مضرب بيسبول', 'قفاز بيسبول',
  'لوح تزلج', 'لوح ركوب أمواج', 'مضرب تنس', 'زجاجة', 'كأس', 'كوب',
  'شوكة', 'سكين', 'ملعقة', 'وعاء', 'موز', 'تفاحة', 'ساندويتش', 'برتقالة',
  'بروكلي', 'جزر', 'هوت دوج', 'بيتزا', 'دونات', 'كعكة', 'كرسي', 'أريكة',
  'نبتة مزروعة', 'سرير', 'طاولة طعام', 'مرحاض', 'تلفاز', 'حاسوب محمول', 'فأرة',
  'جهاز تحكم', 'لوحة مفاتيح', 'هاتف محمول', 'ميكروويف', 'فرن', 'محمصة', 'حوض',
  'ثلاجة', 'كتاب', 'ساعة', 'مزهرية', 'مقص', 'دب لعبة',
  'مجفف شعر', 'فرشاة أسنان',
];

export function labelFor(classId: number, lang: 'ar' | 'en'): string {
  const table = lang === 'ar' ? COCO_LABELS_AR : COCO_LABELS_EN;
  return table[classId] ?? (lang === 'ar' ? 'شيء غير معروف' : 'unknown object');
}
