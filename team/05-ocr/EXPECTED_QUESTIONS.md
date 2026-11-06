# 05 — Expected Questions: OCR

**Q1. Why two engines instead of one OCR for everything?**
ML Kit's Arabic support is weak for our use, while PP-OCRv3 has a real
Arabic recognition model. English is ML Kit's strength. One interface
(`TextRecognizer`) hides the pair, and routing picks by UI language with
cross-fallback.

**Q2. What is PP-OCR's pipeline?**
Detection → recognition. A detection model localizes text boxes; each
line is normalized to 48×640 and fed to a recognition model that emits
per-timestep character scores; CTC decoding turns scores into text.

**Q3. Explain CTC decoding in one minute.**
The recognizer outputs a class per timestep — characters, repeats, and
blanks (class 0). Greedy CTC keeps the argmax per step, drops blanks,
and collapses consecutive repeats, so "ببـــاااب" with blanks becomes
"باب". Our implementation is `ctcGreedyDecode()` with 163 classes
(161 dictionary chars + blank + space).

**Q4. Where did the Arabic character set come from?**
PaddleOCR's official `arabic_dict.txt`, copied verbatim into
`src/ai/arabicDict.ts` — class layout 0 = blank, 1..161 = characters,
162 = space. Using the model's own dictionary is what makes the class
indices meaningful.

**Q5. Does OCR need the internet?**
No. Both engines run on-device: PP-OCR as bundled TFLite models, ML Kit
on-device recognition.

**Q6. What are the known Arabic OCR weaknesses?**
Dotted letters (ب/ت/ث/ن، ج/ح/خ) can be confused, especially in small or
decorative fonts; handwriting is unreliable; heavy skew and low light
hurt detection. We state these instead of demoing around them.

**Q7. Why is OCR text spoken verbatim?**
Because it may be a name, a number, an address, or a medicine label.
The narration layer that summarizes scenes is forbidden from rewriting
recognized text — a product rule, enforced by design and tests.

**Q8. What happens if both engines fail?**
`OcrUnavailableError` — the read screen says reading is unavailable and
why, and offers a retry. No placeholder text is ever invented.

**Q9. Why normalize the image in the router?**
The Arabic engine has no input normalization of its own, and both
engines must see the same predictable input (local JPEG, bounded size).
Doing it once in `RoutingTextRecognizer` guarantees that; injected test
engines receive the caller's image untouched.

**Q10. How is OCR tested without a camera?**
Bundled sample images (Arabic + English) for device runs, and unit
tests for the deterministic parts: CTC decode, box extraction,
dictionary layout (`arabicOcr.test.ts`).

**Q11. Could you add a third engine (e.g., cloud OCR)?**
The interface allows it, but cloud OCR sends private documents off the
device; it would have to be an explicit, consented option — not a
default. Currently there is none.

**Q12. Detection canvas 960 and line size 48×640 — why those numbers?**
They are the PP-OCR models' expected input geometry: detection runs on
a 960 canvas for accuracy on page-size images; the recognizer was
trained on 48×640 line crops, so inputs are resized to exactly that.
