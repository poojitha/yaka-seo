import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { PageResult } from '@shared/types';
import { makeResult } from '../fixtures';
import { Dashboard } from '../../src/renderer/src/Dashboard';

const page = (path: string, overrides: Partial<PageResult> = {}) =>
    makeResult({
        url: `https://example.com${path}`,
        canonical: `https://example.com${path}`,
        title: `Title of ${path} page`,
        titleLength: 40,
        metaDescription: `Description of ${path}`,
        metaDescriptionLength: 120,
        h1: `H1 ${path}`,
        hash: path,
        ...overrides,
    });

const rows = [
    page('/'),
    page('/blog/a', { depth: 1 }),
    page('/blog/b', { depth: 1, titleLength: 0, title: '' }),
    page('/shop/missing', { depth: 1, status: 404, contentType: 'text/html', indexable: false, indexabilityReason: 'Status 404' }),
    makeResult({ url: 'https://example.com/old', redirectUrl: 'https://example.com/older', status: 301, statusText: 'Moved Permanently', redirectType: 'HTTP Redirect', indexable: false, depth: 1 }),
    makeResult({ url: 'https://example.com/older', redirectUrl: 'https://example.com/', status: 302, statusText: 'Found', redirectType: 'HTTP Redirect', indexable: false, depth: 2 }),
];

function renderDashboard(renderJs = true, data = rows) {
    const onOpen = vi.fn();
    render(<Dashboard rows={data} renderJs={renderJs} onOpen={onOpen} />);
    return onOpen;
}

const panel = (title: string) => screen.getByRole('heading', { name: title }).closest('section')!;

describe('Dashboard', () => {
    it('scores health as the share of URLs without an error-level issue', () => {
        const onOpen = renderDashboard();
        // 2 of 6 URLs have errors (the 404, and the page with no title).
        expect(screen.getByRole('meter', { name: 'Site health' }).getAttribute('aria-valuenow')).toBe('67');
        expect(screen.getByText('Needs work')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '2 errors' }));
        expect(onOpen).toHaveBeenCalledWith('severity-error');
    });

    it('groups issues by severity, and an issue opens its filter', () => {
        const onOpen = renderDashboard();
        const issues = panel('Issues by severity');
        expect(within(issues).getByRole('heading', { name: /Errors/ })).toBeTruthy();
        fireEvent.click(within(issues).getByRole('button', { name: /^Redirect chains/ }));
        expect(onOpen).toHaveBeenCalledWith('redirect-chain');
    });

    it('shows redirect types and problems', () => {
        renderDashboard();
        const redirects = panel('Redirect health');
        expect(within(redirects).getByText('301 Moved Permanently')).toBeTruthy();
        expect(within(redirects).getByText('302 Found')).toBeTruthy();
        expect(within(redirects).getByRole('button', { name: /^Redirect chains/ })).toBeTruthy();
    });

    it('splits title fit into bands that open the matching filter', () => {
        const onOpen = renderDashboard();
        fireEvent.click(within(panel('Title & description fit')).getAllByRole('button', { name: /^Missing/ })[0]);
        expect(onOpen).toHaveBeenCalledWith('title-missing');
    });

    it('lists site sections, and a section opens the table searched to it', () => {
        const onOpen = renderDashboard();
        const sections = panel('Site sections');
        expect(within(sections).getByText('/ (root)')).toBeTruthy();
        fireEvent.click(within(sections).getByRole('button', { name: '/blog/' }));
        expect(onOpen).toHaveBeenCalledWith('all', '/blog/');
    });

    it('explains the JavaScript-only panels in fast mode', () => {
        renderDashboard(false);
        expect(within(panel('JavaScript dependency')).getByText(/Needs Render JavaScript mode/)).toBeTruthy();
    });

    it('waits for the post-crawl analysis before showing inlinks', () => {
        renderDashboard(true, rows.map((r) => ({ ...r, linkScore: null, uniqueInlinks: null, inlinks: null })));
        expect(within(panel('Internal linking')).getByText(/counted when the crawl finishes/)).toBeTruthy();
    });

    it('marks the technical checklist with words, not just colour', () => {
        renderDashboard();
        const checklist = panel('Technical checklist');
        expect(within(checklist).getByText('HTTPS').parentElement!.textContent).toContain('Pass');
        expect(within(checklist).getByText('HTTP/2 or HTTP/3').parentElement!.textContent).toContain('Missing');
    });
});
