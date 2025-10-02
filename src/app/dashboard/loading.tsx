// app/dashboard/loading.tsx
export default function DashboardLoading() {
    return (
        <main className="min-h-screen relative flex items-center justify-center bg-gradient-to-r from-blue-400 via-blue-500 to-blue-600">
            <div className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-[1px] flex items-center justify-center">
                <div className="flex items-center gap-3 text-white text-lg">
                    <svg
                        className="animate-spin h-6 w-6"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                    >
                        <circle
                            className="opacity-30"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                        />
                        <path
                            className="opacity-90"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                        />
                    </svg>
                    Loading...
                </div>
            </div>
        </main>
    );
}