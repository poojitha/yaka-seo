package crawler

import (
	"math"

	"github.com/projectdiscovery/katana/pkg/engine/standard"
	"github.com/projectdiscovery/katana/pkg/output"
	"github.com/projectdiscovery/katana/pkg/types"
)

type Crawler struct {
	Links []string
}

func NewCrawler() *Crawler {
	return &Crawler{
		Links: []string{},
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

	return nil
}
