package main

import (
	"github.com/poojitha/yaka-seo/utils"

	"github.com/gin-gonic/gin"
	"github.com/poojitha/yaka-seo/crawler"
	"github.com/projectdiscovery/gologger"
)

func init() {
	utils.LoadEnvs()
}

func main() {

	r := gin.Default()
	r.GET("/ping", func(c *gin.Context) {

		crawlerInstance := crawler.NewCrawler()
		var input = "https://www.schmackos.com.au/"
		err := crawlerInstance.Crawl(input)
		if err != nil {
			gologger.Warning().Msgf("Could not crawl %s: %s", input, err.Error())
			c.JSON(500, gin.H{"error": "Crawl failed"})
			return
		}

		c.JSON(200, gin.H{
			"message": crawlerInstance.Links,
		})
	})
	r.Run()

}
