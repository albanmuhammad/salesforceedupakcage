// src/app/debug-auth/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import type { Session } from '@supabase/supabase-js';

export default function DebugAuth() {
    const [cookieStr, setCookieStr] = useState<string>('');
    const [session, setSession] = useState<Session | null>(null);
    const [supabaseCookies, setSupabaseCookies] = useState<string>('');
    const [mounted, setMounted] = useState(false);
    const supabase = createClientComponentClient();

    useEffect(() => {
        setMounted(true);

        // Browser cookies (we're on client)
        const all = document.cookie || '';
        setCookieStr(all);

        const sbCookies = all
            .split(';')
            .map((c) => c.trim())
            .filter((c) => c.startsWith('sb-') || c.toLowerCase().includes('supabase'))
            .join('\n');
        setSupabaseCookies(sbCookies);

        // Client session
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
        });
    }, [supabase]);

    const testApiRoute = async () => {
        try {
            const response = await fetch('/api/salesforce/progress', {
                credentials: 'include', // same-origin cookies are included by default, but this is fine
            });

            const text = await response.text();
            let parsed: unknown;
            try {
                parsed = JSON.parse(text);
            } catch {
                parsed = text;
            }

            console.log('API Response:', parsed);
            alert(`API Response: ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2)}`);
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error('API Error:', msg);
            alert(`API Error: ${msg}`);
        }
    };

    if (!mounted) {
        return <div>Loading...</div>;
    }

    return (
        <div className="p-8 space-y-4">
            <h1 className="text-2xl font-bold">Debug Authentication</h1>

            <button
                onClick={testApiRoute}
                className="bg-blue-500 text-white px-4 py-2 rounded"
            >
                Test API Route
            </button>

            <section>
                <h2 className="text-lg font-semibold">Browser Cookies:</h2>
                <pre className="bg-gray-100 p-4 text-xs overflow-auto max-h-40">
                    {cookieStr || 'No cookies found'}
                </pre>
            </section>

            <section>
                <h2 className="text-lg font-semibold">Client Session:</h2>
                <pre className="bg-gray-100 p-4 text-xs overflow-auto max-h-40">
                    {session ? JSON.stringify(session, null, 2) : 'No session found'}
                </pre>
            </section>

            <section>
                <h2 className="text-lg font-semibold">Supabase Cookies:</h2>
                <pre className="bg-gray-100 p-4 text-xs overflow-auto max-h-40">
                    {supabaseCookies || 'No Supabase cookies found'}
                </pre>
            </section>
        </div>
    );
}
