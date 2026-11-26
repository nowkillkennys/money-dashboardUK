/** The evaluation image must never silently start real-data handlers. */
if(process.env.UK_DEMO_ONLY!=='true'||process.env.NEXT_PUBLIC_UK_DEMO_ONLY!=='true') {
  console.error('UK preview requires both demo-only flags. Refusing to start.');process.exit(1);
}
process.argv=['node','next','start','--hostname','0.0.0.0','--port','3000'];
require('next/dist/bin/next');
