// src/app/debug-auth/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

export default function DebugAuth() {
    const [cookies, setCookies] = useState<string>('');
    const [session, setSession] = useState<any>(null);
    const [supabaseCookies, setSupabaseCookies] = useState<string>('');
    const [mounted, setMounted] = useState(false);
    const supabase = createClientComponentClient();

    useEffect(() => {
        setMounted(true);

        if (typeof window !== 'undefined') {
            // Check cookies from browser
            setCookies(document.cookie);

            // Filter Supabase cookies
            const sbCookies = document.cookie.split(';')
                .filter(c => c.includes('supabase') || c.includes('sb-'))
                .join('\n');
            setSupabaseCookies(sbCookies);
        }

        // Check session from client-side
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
        });
    }, []);

    const testApiRoute = async () => {
        try {
            const response = await fetch('/api/salesforce/progress', {
                credentials: 'include', // Important: include cookies
                headers: {
                    'Content-Type': 'application/json',
                },
            });
            const data = await response.json();
            console.log('API Response:', data);
            alert(`API Response: ${JSON.stringify(data, null, 2)}`);
        } catch (error) {
            console.error('API Error:', error);
            alert(`API Error: ${error}`);
        }
    };

    if (!mounted) {
        return <div>Loading...</div>;
    }

    return (
        <div className="p-8">
            <h1 className="text-2xl font-bold mb-4">Debug Authentication</h1>

            <button
                onClick={testApiRoute}
                className="bg-blue-500 text-white px-4 py-2 rounded mb-4"
            >
                Test API Route
            </button>

            <div className="mt-4">
                <h2 className="text-lg font-semibold">Browser Cookies:</h2>
                <pre className="bg-gray-100 p-4 text-xs overflow-auto max-h-40">
                    {cookies || 'No cookies found'}
                </pre>
            </div>

            <div className="mt-4">
                <h2 className="text-lg font-semibold">Client Session:</h2>
                <pre className="bg-gray-100 p-4 text-xs overflow-auto max-h-40">
                    {JSON.stringify(session, null, 2) || 'No session found'}
                </pre>
            </div>

            <div className="mt-4">
                <h2 className="text-lg font-semibold">Supabase Cookies:</h2>
                <pre className="bg-gray-100 p-4 text-xs overflow-auto max-h-40">
                    {supabaseCookies || 'No Supabase cookies found'}
                </pre>
            </div>
        </div>
    );
}