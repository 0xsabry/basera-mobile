/**
 * The single app-wide voice-recognition session owner. The voice screen
 * and the Assistance hub (Stop listening) must act on the SAME session —
 * two service instances would leave one of them listening forever.
 */
import { NativeVoiceCommandService } from './VoiceCommandService';

export const voiceCommandService = new NativeVoiceCommandService();
