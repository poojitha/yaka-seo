package main

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/poojitha/yaka-seo/utils"
)

func init() {
	utils.LoadEnvs()
}

func main() {
	links, err := webpage.getHrefs("https://google.com")

	if err != nil {
		fmt.Println(links)
	}

	r := gin.Default()
	r.GET("/", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"message": "here",
		})
	})
	r.Run()
}
