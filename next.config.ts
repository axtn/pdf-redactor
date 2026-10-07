import type { NextConfig } from 'next';

const config: NextConfig = {
  distDir: process.env.PDF_REDACTOR_TEST_BUILD === '1' ? '.next-test' : '.next',
  poweredByHeader: false,
  devIndicators: false,
  turbopack: { root: process.cwd() },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  },
};

export default config;
