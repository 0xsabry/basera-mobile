import { COMMAND_REGISTRY, parseVoiceCommand } from '../VoiceCommandService';

describe('parseVoiceCommand — English', () => {
  it.each([
    ['What is in front of me?', 'describe'],
    ['read this text', 'read-text'],
    ['repeat', 'repeat'],
    ['stop speaking', 'stop'],
    ['change language', 'change-language'],
    ['open settings', 'open-settings'],
    ['go home', 'go-home'],
  ])('"%s" -> %s', (input, action) => {
    const cmd = parseVoiceCommand(input);
    expect(cmd.action).toBe(action);
    expect(cmd.implemented).toBe(true);
  });
});

describe('parseVoiceCommand — Arabic', () => {
  it.each([
    ['ايه اللي قدامي؟', 'describe'],
    ['اقرأ النص', 'read-text'],
    ['كرر', 'repeat'],
    ['اسكت', 'stop'],
    ['توقف', 'stop'],
    ['غير اللغة', 'change-language'],
    ['افتح الإعدادات', 'open-settings'],
    ['ارجع للرئيسية', 'go-home'],
  ])('"%s" -> %s', (input, action) => {
    expect(parseVoiceCommand(input).action).toBe(action);
  });
});

describe('parseVoiceCommand — hazards + places intents', () => {
  it.each([
    ['استغاثة', 'sos', undefined],
    ['help me', 'sos', undefined],
    ['أنا بخير', 'acknowledge-ok', undefined],
    ["i'm okay", 'acknowledge-ok', undefined],
    ['احفظ المكان ده باسم البيت', 'save-place', 'البيت'],
    ['save this place as University', 'save-place', 'university'],
    ['احفظ المكان ده', 'save-place-unnamed', undefined],
    ['save this place', 'save-place-unnamed', undefined],
    ['إيه الأماكن اللي حفظتها؟', 'list-places', undefined],
    ['what places have i saved', 'list-places', undefined],
    ['فين الجامعة؟', 'find-place', 'الجامعة'],
    ['where is the pharmacy', 'find-place', 'the pharmacy'],
    ['أنا قريب من البيت؟', 'near-place', 'البيت'],
    ['امسح المكان المحفوظ باسم النادي', 'delete-place', 'النادي'],
    ['كرر وصف المكان', 'describe-place', undefined],
    ['describe the place', 'describe-place', undefined],
  ])('"%s" -> %s (arg=%s)', (input, action, argument) => {
    const cmd = parseVoiceCommand(input);
    expect(cmd.action).toBe(action);
    expect(cmd.implemented).toBe(true);
    expect(cmd.argument).toBe(argument);
  });

  it('generic commands still win where there is no specific pattern', () => {
    expect(parseVoiceCommand('describe').action).toBe('describe');
    expect(parseVoiceCommand('كرر').action).toBe('repeat');
    expect(parseVoiceCommand('اقرأ النص').action).toBe('read-text');
  });
});

describe('registry honesty', () => {
  it('planned command is parsed but marked not implemented', () => {
    const cmd = parseVoiceCommand('is the path clear');
    expect(cmd.action).toBe('obstacle-check');
    expect(cmd.implemented).toBe(false);
  });
  it('unknown input -> unknown, not implemented', () => {
    const cmd = parseVoiceCommand('xyzzy nonsense');
    expect(cmd.action).toBe('unknown');
    expect(cmd.implemented).toBe(false);
  });
  it('registry has both implemented and planned entries', () => {
    expect(COMMAND_REGISTRY.some((c) => c.implemented)).toBe(true);
    expect(COMMAND_REGISTRY.some((c) => !c.implemented)).toBe(true);
  });
});
