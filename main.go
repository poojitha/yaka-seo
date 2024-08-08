package main

import (
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/poojitha/yaka-seo/linkr"
	"github.com/poojitha/yaka-seo/utils"
	"github.com/poojitha/yaka-seo/webpage"
)

func init() {
	utils.LoadEnvs()
}

func main() {

	mainHost, _ := linkr.ParseLink("https://www.gossiplanka.com/fff/kkk")
	pageContent, err := webpage.ReadCotent(mainHost.Scheme + "://" + mainHost.Host)

	if err == nil {
		links, err := webpage.GetTagValues(pageContent, "a", "href")
		var loopLinks func(links []string)

		loopLinks = func(links []string) {
			var links2 []string
			for i := 0; i < len(links); i++ {
				if strings.Contains(mainHost.Host, links[i]) {
					fmt.Printf("Parsed Host: %s", links[i])
					pageContent, err := webpage.ReadCotent(links[i])
					if err == nil {
						links2, _ = webpage.GetTagValues(pageContent, "a", "href")
						loopLinks(links2)
					}
					if i == 10 {
						os.Exit(1)
					}

				}

			}

		}

		loopLinks(links)

		if err != nil {
			fmt.Println("Getting tag values:", err)
		}
	}

	r := gin.Default()
	r.GET("/", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"message": "here",
		})
	})
	r.Run()
}
