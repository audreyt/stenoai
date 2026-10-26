#!/usr/bin/env node
'use strict';

const fs = require('fs');

if (require.main === module) {
  const [command, locale = 'auto'] = process.argv.slice(2);
  const logFile = process.env.STENOAI_MOCK_SIDECAR_LOG;
  if (logFile) {
    const entry =
      JSON.stringify({
        args: process.argv.slice(2),
        time: Date.now(),
        pid: process.pid,
      }) + '\n';
    try {
      fs.appendFileSync(logFile, entry, 'utf8');
    } catch {
      // Best-effort write
    }
  }

  if (command === 'status') {
    const supported = locale !== process.env.STENOAI_MOCK_SIDECAR_REJECT_LOCALE;
    process.stdout.write(JSON.stringify({
      success: true,
      available: true,
      supported,
      installed: supported,
      locale,
      display_name: 'Apple On-Device',
      system_managed: true,
    }) + '\n');
    process.exit(0);
  }
  if (command === 'prepare') {
    process.stderr.write('Unexpected model preparation in model-free test\n');
    process.exit(1);
  }
  if (command === 'transcribe-file') {
    process.stdout.write(JSON.stringify({ success: true, text: '', segments: [] }) + '\n');
    process.exit(0);
  }
  if (command !== 'stream') process.exit(2);

  // Emit LIVE_READY protocol line so main.js marks liveTranscriptState.ready = true
  process.stdout.write('LIVE_READY:\n');

  let emittedSegment = false;

  // Drain stdin and exit cleanly on stream close or signal
  process.stdin.resume();
  process.stdin.on('data', () => {
    if (!emittedSegment) {
      emittedSegment = true;
      const segment = {
        text: `Apple live utterance (${locale})`,
        start: 0.0,
        end: 2.5,
        is_final: true,
        speaker: 'You',
      };
      process.stdout.write(`LIVE_SEG:${JSON.stringify(segment)}\n`);
    }
  });
  process.stdin.on('end', () => {
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    process.exit(0);
  });
  process.on('SIGINT', () => {
    process.exit(0);
  });
}
