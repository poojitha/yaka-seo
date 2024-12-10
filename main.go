package main

import (
	"os"

	"github.com/gin-gonic/gin"
	"github.com/poojitha/yaka-seo/crawler"
	"github.com/poojitha/yaka-seo/utils"
	"github.com/projectdiscovery/gologger"
)

func init() {
	utils.LoadEnvs()
}

func main() {

	r := gin.Default()

	var PORT = os.Getenv("PORT")
	var BASE_URL = os.Getenv("BASE_URL")

	if PORT == "" {
		PORT = "3837"
	}

	r.LoadHTMLGlob("html/*")

	var loadUrl = " --app=" + BASE_URL + ":" + PORT
	utils.LoadUi(loadUrl)

	r.GET("/", func(c *gin.Context) {
		c.HTML(200, "main.html", gin.H{
			"title":   "Welcome to Gin",
			"message": "Dynamic content with Gin Templates!",
		})
	})

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
