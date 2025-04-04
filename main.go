package main

import (
	"fmt"
	"net/http"
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

	// 🔹 Serve static assets from Next.js build (e.g., JS, CSS, images)
	r.StaticFS("/_next", http.Dir("frontend/out/_next"))
	r.StaticFS("/images", http.Dir("frontend/out/images"))

	// 🔹 Catch-all: Serve Next.js `index.html` for frontend routes
	r.NoRoute(func(c *gin.Context) {
		c.File("frontend/out/index.html")
	})

	// 🔹 API Route (Unchanged)
	r.GET("/getAllCrawledLinks", func(c *gin.Context) {
		crawlerInstance := crawler.NewCrawler()

		var input = c.Query("query")
		stdURL, _ := utils.StandardizeURL(input)
		if input != "" {
			err := crawlerInstance.Crawl(stdURL)
			if err != nil {
				gologger.Warning().Msgf("Could not crawl %s: %s", input, err.Error())
				c.JSON(500, gin.H{"error": "Crawl failed"})
				return
			}

			fmt.Println("Images:", crawlerInstance.GetLinksByType("images"))
			fmt.Println("PDFs:", crawlerInstance.GetLinksByType("pdfs"))
			fmt.Println("CSS:", crawlerInstance.GetLinksByType("css"))
			fmt.Println("HTML:", crawlerInstance.GetLinksByType("html"))
			fmt.Printf("Total links found: %d\n", len(crawlerInstance.Links))

			fileTypeCounts := map[string]int{
				"image": len(crawlerInstance.GetLinksByType("images")),
				"pfd":   len(crawlerInstance.GetLinksByType("pdfs")),
				"css":   len(crawlerInstance.GetLinksByType("css")),
				"html":  len(crawlerInstance.GetLinksByType("html")),
			}

			c.JSON(200, gin.H{
				"links": crawlerInstance.Links,
				"count": fileTypeCounts,
			})
		} else {
			c.JSON(200, gin.H{
				"links": []string{},
			})
		}
	})

	var loadUrl = " --app=" + BASE_URL + ":" + PORT
	utils.LoadUi(loadUrl)
	// 🔹 Start the Gin server
	r.Run(":" + PORT)
}
