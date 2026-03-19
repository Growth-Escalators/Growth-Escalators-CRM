import React, { useState, useEffect } from 'react';
import { Timer, ArrowRight, ShieldCheck } from 'lucide-react';

const DURATION = 15 * 60; // 15 minutes in seconds
// sessionStorage: timer persists across reloads in the same tab,
// but resets when the user opens a new tab or new browser session.
// This prevents the "00:00 trust killer" for returning visitors.
const STORAGE_KEY = 'offer_timer_start_v2';

const StickyFooter = ({ scrollToForm }) => {
    const [timeLeft, setTimeLeft] = useState(() => {
        const stored = sessionStorage.getItem(STORAGE_KEY);
        if (stored) {
            const elapsed = Math.floor((Date.now() - parseInt(stored, 10)) / 1000);
            return Math.max(0, DURATION - elapsed);
        }
        sessionStorage.setItem(STORAGE_KEY, Date.now().toString());
        return DURATION;
    });

    useEffect(() => {
        if (timeLeft === 0) return;
        const timer = setInterval(() => {
            setTimeLeft((prev) => {
                if (prev <= 1) {
                    clearInterval(timer);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(timer);
    }, [timeLeft]);

    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const expired = timeLeft === 0;

    return (
        <div className="fixed bottom-0 left-0 right-0 bg-[#0f172a]/95 backdrop-blur-md border-t border-gray-800 p-4 z-50 animate-in slide-in-from-bottom-full duration-500">
            <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">

                {/* Timer or expired state */}
                <div className="flex items-center gap-2 font-mono font-bold text-xl shrink-0">
                    {expired ? (
                        <span className="text-red-400 text-sm font-bold uppercase tracking-wide animate-pulse">
                            Price going up
                        </span>
                    ) : (
                        <>
                            <Timer className="w-5 h-5 text-orange-500 animate-pulse" />
                            <span className="text-orange-500">{formatTime(timeLeft)}</span>
                        </>
                    )}
                </div>

                {/* Center text — desktop only */}
                <div className="flex-1 md:text-center hidden md:block">
                    <p className="text-gray-300 text-sm">
                        {expired
                            ? 'Offer closing soon — lock in ₹9 before the price increases.'
                            : <>Offer expires soon! <span className="font-bold text-orange-400 underline italic">CLAIM FOR ₹9</span> before access closes.</>
                        }
                    </p>
                </div>

                {/* CTA + guarantee */}
                <div className="flex flex-col items-end gap-1 shrink-0">
                    <button
                        onClick={scrollToForm}
                        className="bg-orange-600 hover:bg-orange-500 text-white font-bold py-3 px-6 rounded-xl shadow-lg shadow-orange-900/20 flex items-center gap-2 text-sm md:text-base transition-all transform hover:scale-105"
                    >
                        Claim for ₹9 Only
                        <ArrowRight className="w-4 h-4" />
                    </button>
                    <p className="text-xs flex items-center gap-1 text-green-500/80 font-medium">
                        <ShieldCheck className="w-3 h-3" />
                        100% money-back guarantee
                    </p>
                </div>
            </div>
        </div>
    );
};

export default StickyFooter;
