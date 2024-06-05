package main

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/poojitha/yaka-seo/utils"
	"github.com/poojitha/yaka-seo/webpage"
	"golang.org/x/net/html"
)

func init() {
	utils.LoadEnvs()
}

func extractLinks(n *html.Node, links chan string) {
	if n.Type == html.ElementNode && n.Data == "a" {
		for _, a := range n.Attr {
			if a.Key == "href" {
				links <- a.Val
			}
		}
	}

	for c := n.FirstChild; c != nil; c = c.NextSibling {
		extractLinks(c, links)
	}
}

func main() {

	url := "https://www.optimumpet.com.au"
	content, err := webpage.ReadCotent(url)
	fmt.Println(content)

	if err != nil {
		fmt.Println(err)
	}

	r := gin.Default()
	r.GET("/", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"message": "here",
		})
	})
	r.Run()
}
