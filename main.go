package main

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/poojitha/yaka-seo/utils"
	"github.com/poojitha/yaka-seo/webpage"
)

func init() {
	utils.LoadEnvs()
}

func main() {

	pageContent, err := webpage.ReadCotent("https://google.com")

	if err == nil {
		links, err := webpage.GetTagValues(pageContent, "a", "href")
		if err == nil {
			fmt.Println(links)
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
