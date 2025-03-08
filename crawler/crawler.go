package crawler

import (
	"math"
	"path/filepath"
	"strings"

	"github.com/projectdiscovery/katana/pkg/engine/standard"
	"github.com/projectdiscovery/katana/pkg/output"
	"github.com/projectdiscovery/katana/pkg/types"
)

type Crawler struct {
	Links       []string
	LinksByType map[string][]string // Map to store links by file type
}

func NewCrawler() *Crawler {
	return &Crawler{
		Links:       []string{},
		LinksByType: make(map[string][]string),
	}
}

func (c *Crawler) Crawl(input string) error {
	options := &types.Options{
		MaxDepth:     3,
		FieldScope:   "rdn",
		BodyReadSize: math.MaxInt,
		Timeout:      10,
		Concurrency:  10,
		Parallelism:  10,
		Delay:        0,
		RateLimit:    150,
		Strategy:     "depth-first",
		OnResult: func(result output.Result) {
			c.Links = append(c.Links, result.Request.URL)
		},
	}

	crawlerOptions, err := types.NewCrawlerOptions(options)
	if err != nil {
		return err
	}
	defer crawlerOptions.Close()

	crawler, err := standard.New(crawlerOptions)
	if err != nil {
		return err
	}
	defer crawler.Close()

	err = crawler.Crawl(input)
	if err != nil {
		return err
	}

	// After crawling, categorize links by file type
	c.CategorizeLinks()
	return nil
}

// cleanExtension removes query parameters and fragments from a URL and returns its extension
func cleanExtension(url string) string {
	// Remove query parameters (?...) and fragments (#...)
	cleaned := url
	if idx := strings.IndexAny(url, "?#"); idx != -1 {
		cleaned = url[:idx]
	}
	// Extract the extension from the cleaned URL
	return strings.ToLower(filepath.Ext(cleaned))
}

// CategorizeLinks separates links into categories based on their cleaned file extensions
func (c *Crawler) CategorizeLinks() {
	// Define common file extensions for each category
	extensionMap := map[string]string{
		"images": ".jpg,.jpeg,.png,.gif,.webp",
		"pdfs":   ".pdf",
		"css":    ".css",
		"html":   ".html,.htm",
		"js":     ".js", // Added JavaScript as an example
	}

	// Initialize categories in LinksByType
	for category := range extensionMap {
		c.LinksByType[category] = []string{}
	}

	// Categorize each link
	for _, link := range c.Links {
		ext := cleanExtension(link)
		if ext == "" {
			// If no extension, assume it's an HTML page
			c.LinksByType["html"] = append(c.LinksByType["html"], link)
			continue
		}

		// Check each category
		for category, exts := range extensionMap {
			if strings.Contains(exts, ext) {
				c.LinksByType[category] = append(c.LinksByType[category], link)
				break
			}
		}
	}
}

// GetLinksByType returns links for a specific file type category
func (c *Crawler) GetLinksByType(category string) []string {
	return c.LinksByType[category]
}
