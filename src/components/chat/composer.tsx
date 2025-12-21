"use client";

import { FormEvent, KeyboardEvent, useState } from 'react';
import { ArrowUp } from 'lucide-react';

type ChatComposerProps = {
    onSend: (message: string) => void;
    authenticated: boolean;
    placeholder?: string;
};

export function ChatComposer({ onSend, authenticated, placeholder }: ChatComposerProps) {
    const [value, setValue] = useState('');

    const trimmedValue = value.trim();

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!trimmedValue || !authenticated) {
            return;
        }
        onSend(trimmedValue);
        setValue('');
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            if (trimmedValue && authenticated) {
                onSend(trimmedValue);
                setValue('');
            }
        }
    };

    return (
        <form className="composer-form" onSubmit={handleSubmit}>
            <div className="composer-shell">
                <textarea
                    className="composer-textarea"
                    placeholder={placeholder ?? 'What are we working on?'}
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={1}
                    disabled={!authenticated}
                    spellCheck={false}
                />
                <div className="composer-actions">
                    <button
                        type="submit"
                        className="composer-send-button"
                        disabled={!trimmedValue || !authenticated}
                        aria-label="Send prompt"
                    >
                        <ArrowUp />
                    </button>
                </div>
            </div>
        </form>
    );
}
