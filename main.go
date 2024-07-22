package main

import (
	"fmt"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/poojitha/yaka-seo/utils"
	"github.com/poojitha/yaka-seo/webpage"
)

func init() {
	utils.LoadEnvs()
}

func main() {
	pageContent, err := webpage.ReadCotent("https://www.gossiplanka.com/")
	if err == nil {
		links, err := webpage.GetTagValues(pageContent, "a", "href")
		var loopLinks func(links []string)

		loopLinks = func(links []string) {
			var links2 []string
			for i := 0; i < len(links); i++ {
				fmt.Printf("<=====> %s", links[i])
				pageContent, err := webpage.ReadCotent(links[i])
				if err == nil {
					links2, _ = webpage.GetTagValues(pageContent, "a", "href")
					fmt.Println(links2)
					loopLinks(links2)
				}
				if i == 3 {
					os.Exit(1)
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
