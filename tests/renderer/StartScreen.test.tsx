import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { CrawlOptions } from '@shared/types';
import { StartScreen } from '../../src/renderer/src/StartScreen';

const initial: CrawlOptions = { startUrl: 'https://', maxPages: 500, maxDepth: 10, concurrency: 10, renderJs: true };

const setup = (overrides: Partial<CrawlOptions> = {}) => {
    const onStart = vi.fn();
    const onClose = vi.fn();
    render(<StartScreen initial={{ ...initial, ...overrides }} onStart={onStart} onClose={onClose} />);
    return { onStart, onClose };
};

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });

describe('StartScreen', () => {
    it('shows the URL, settings and Render JavaScript fields filled from the initial options', () => {
        setup();
        expect(field('Website URL').value).toBe('https://');
        expect(field('Max pages').value).toBe('500');
        expect(field('Depth').value).toBe('10');
        expect(field('Threads').value).toBe('10');
        expect(field('Render JavaScript').checked).toBe(true);
        expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy();
    });

    it('starts with the edited settings', () => {
        const { onStart } = setup();
        type('Website URL', 'https://example.com');
        type('Max pages', '50');
        type('Depth', '2');
        type('Threads', '4');
        fireEvent.click(field('Render JavaScript'));
        fireEvent.click(screen.getByRole('button', { name: 'Start' }));
        expect(onStart).toHaveBeenCalledWith({ startUrl: 'https://example.com', maxPages: 50, maxDepth: 2, concurrency: 4, renderJs: false });
    });

    it('pressing Enter in the URL field starts the crawl', () => {
        const { onStart } = setup({ startUrl: 'https://example.com' });
        fireEvent.submit(field('Website URL'));
        expect(onStart).toHaveBeenCalledOnce();
    });

    it.each(['https://', 'example.com', 'not a url', ''])('rejects the invalid URL %j with an error', (url) => {
        const { onStart } = setup();
        type('Website URL', url);
        fireEvent.click(screen.getByRole('button', { name: 'Start' }));
        expect(onStart).not.toHaveBeenCalled();
        expect(screen.getByText(/Enter a valid URL/)).toBeTruthy();
    });

    it('clears the error once the URL is edited', () => {
        setup();
        fireEvent.click(screen.getByRole('button', { name: 'Start' }));
        expect(screen.queryByText(/Enter a valid URL/)).toBeTruthy();
        type('Website URL', 'https://example.com');
        expect(screen.queryByText(/Enter a valid URL/)).toBeNull();
    });

    it('the close button calls onClose without starting', () => {
        const { onStart, onClose } = setup();
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        expect(onClose).toHaveBeenCalledOnce();
        expect(onStart).not.toHaveBeenCalled();
    });
});
