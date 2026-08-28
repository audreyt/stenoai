import { describe, expect, test } from 'vitest';
import type { Meeting } from '@/lib/ipc';
import { buildTranscriptBundle } from '@/lib/transcriptBundle';

function meeting(overrides: Partial<Meeting> & { diarised_text?: string }): Meeting {
  return {
    session_info: {
      name: 'Project sync',
      duration_seconds: 45,
      processed_at: '2026-01-15T12:00:00.000Z',
    },
    summary: '',
    is_diarised: true,
    transcript: '',
    ...overrides,
  } as Meeting;
}

describe('buildTranscriptBundle conversation view', () => {
  test('non-diarised transcripts stay a single Transcript section', () => {
    const bundle = buildTranscriptBundle(
      meeting({
        is_diarised: false,
        diarised_text: '',
        transcript: 'Alice: we ship Friday.\nBob: I will prep the release notes.',
        participants: ['Alice', 'Bob'],
      }),
    );
    expect(bundle).toContain('# Project sync');
    expect(bundle).toContain('Participants: Alice, Bob');
    expect(bundle).toContain(
      '## Transcript\nAlice: we ship Friday.\nBob: I will prep the release notes.',
    );
    expect(bundle).not.toContain('## Timestamped transcript');
  });

  test('You becomes Me; adjacent fragments merge; a pause stays two turns', () => {
    const adjacent = buildTranscriptBundle(
      meeting({
        diarised_text: '[00:00] [You] This fragment\n[00:02] [You] continues.',
      }),
    );
    expect(adjacent).toContain('## Transcript\nMe: This fragment continues.');
    expect(adjacent).toContain('## Timestamped transcript');
    expect(adjacent).toContain('[00:00] [You] This fragment');
    expect(adjacent).toContain('[00:02] [You] continues.');

    const chain = buildTranscriptBundle(
      meeting({
        diarised_text:
          '[00:00] [You] One.\n[00:02] [You] Two.\n[00:04] [You] Three.',
      }),
    );
    expect(chain).toContain('Me: One. Two. Three.');

    const paused = buildTranscriptBundle(
      meeting({
        diarised_text: '[00:00] [You] First thought.\n[00:15] [You] Later thought.',
      }),
    );
    expect(paused).toContain('Me: First thought.\n\nMe: Later thought.');
  });

  test('alternating channels keep honest labels and all source timestamps', () => {
    const body = [
      '[00:03] [You] Local opening.',
      '[00:07] [Others] Remote response.',
      '[00:10] [You] Local follow-up.',
      '[00:14] [Others] Remote follow-up.',
      '[00:18] [You] Final local remark.',
    ].join('\n');
    const bundle = buildTranscriptBundle(meeting({ diarised_text: body }));
    expect(bundle).not.toContain('Participants:');
    expect(bundle).toContain('Me: Local opening.');
    expect(bundle).toContain('Others: Remote response.');
    expect(bundle).toContain('## Timestamped transcript');
    expect(bundle).toContain('[00:03] [You] Local opening.');
    expect(bundle).toContain('[00:18] [You] Final local remark.');
  });
});
