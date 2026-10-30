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
