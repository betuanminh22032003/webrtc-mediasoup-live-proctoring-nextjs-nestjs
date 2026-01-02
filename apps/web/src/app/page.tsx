import Link from 'next/link';

/**
 * Home Page - Entry point for the proctoring application
 *
 * This page serves as:
 * 1. Landing page with role selection
 * 2. Quick demo for Phase 1 (pure WebRTC)
 */
export default function HomePage(): JSX.Element {
  return (
    <main className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold">
            🎥 Live Proctoring System
          </h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-400">
              Phase 1: Pure WebRTC
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-4xl w-full">
          {/* Hero Section */}
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold mb-4">
              WebRTC Live Proctoring
            </h2>
            <p className="text-xl text-gray-400 mb-8">
              Production-grade exam monitoring with real-time video streaming
            </p>

            {/* Tech Stack Badge */}
            <div className="flex flex-wrap justify-center gap-2 mb-8">
              {['WebRTC', 'mediasoup', 'Next.js 14', 'NestJS', 'TypeScript'].map(
                (tech) => (
                  <span
                    key={tech}
                    className="px-3 py-1 bg-gray-800 rounded-full text-sm"
                  >
                    {tech}
                  </span>
                )
              )}
            </div>
          </div>

          {/* Role Selection Cards */}
          <div className="grid md:grid-cols-2 gap-6 mb-12">
            {/* Candidate Card */}
            <Link href="/candidate" className="group">
              <div className="p-6 bg-gray-900 rounded-xl border border-gray-800 hover:border-blue-500 transition-colors">
                <div className="text-4xl mb-4">👤</div>
                <h3 className="text-xl font-semibold mb-2 group-hover:text-blue-400">
                  Join as Candidate
                </h3>
                <p className="text-gray-400 mb-4">
                  Take an exam with proctored video monitoring. Your webcam and
                  screen will be shared with the proctor.
                </p>
                <ul className="text-sm text-gray-500 space-y-1">
                  <li>✓ Webcam streaming</li>
                  <li>✓ Screen sharing</li>
                  <li>✓ Connection monitoring</li>
                </ul>
              </div>
            </Link>

            {/* Proctor Card */}
            <Link href="/proctor" className="group">
              <div className="p-6 bg-gray-900 rounded-xl border border-gray-800 hover:border-green-500 transition-colors">
                <div className="text-4xl mb-4">👁️</div>
                <h3 className="text-xl font-semibold mb-2 group-hover:text-green-400">
                  Join as Proctor
                </h3>
                <p className="text-gray-400 mb-4">
                  Monitor multiple candidates in real-time. View their webcams
                  and screens simultaneously.
                </p>
                <ul className="text-sm text-gray-500 space-y-1">
                  <li>✓ Multi-stream view</li>
                  <li>✓ Event timeline</li>
                  <li>✓ Violation alerts</li>
                </ul>
              </div>
            </Link>
          </div>

          {/* Quick Test Section */}
          <div className="p-6 bg-gray-900 rounded-xl border border-gray-800">
            <h3 className="text-lg font-semibold mb-4">
              🧪 Phase 1: Pure WebRTC Demo
            </h3>
            <p className="text-gray-400 mb-4">
              Test your camera and screen sharing without any external services.
              This demonstrates the fundamentals of WebRTC before we add the
              mediasoup SFU.
            </p>
            <Link
              href="/demo"
              className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              Start Camera Test →
            </Link>
          </div>

          {/* Implementation Phases */}
          <div className="mt-12 text-center">
            <h3 className="text-lg font-semibold mb-4">Implementation Phases</h3>
            <div className="flex flex-wrap justify-center gap-3">
              <PhaseIndicator phase={1} label="Pure WebRTC" active />
              <PhaseIndicator phase={2} label="mediasoup SFU" />
              <PhaseIndicator phase={3} label="Proctoring Logic" />
              <PhaseIndicator phase={4} label="Recording" />
              <PhaseIndicator phase={5} label="Scaling" />
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-gray-800 px-6 py-4">
        <div className="max-w-7xl mx-auto text-center text-sm text-gray-500">
          Built for learning WebRTC + mediasoup • Not for production use without
          proper security review
        </div>
      </footer>
    </main>
  );
}

function PhaseIndicator({
  phase,
  label,
  active = false,
}: {
  phase: number;
  label: string;
  active?: boolean;
}): JSX.Element {
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
        active ? 'bg-blue-600' : 'bg-gray-800'
      }`}
    >
      <span className="font-mono text-sm">P{phase}</span>
      <span className="text-sm">{label}</span>
    </div>
  );
}
