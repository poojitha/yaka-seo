package utils

import (
	"crypto/sha256"
	"encoding/hex"
	"log"

	"github.com/joho/godotenv"
)

/*
Load the environment variables
*/
func LoadEnvs() {
	err := godotenv.Load()
	if err != nil {
		log.Fatal("Error loading .env file")
	}
}

/*
Hash generates an SHA-256 hash of the input string and returns the first 'length' characters of the hash as a string.
- str: The input string to be hashed.
- length: The number of characters to be returned from the beginning of the hashed string.
- Returns: A string representing the first 'length' characters of the SHA-256 hash of the input string.
*/
func Hash(str string, length int) string {
	// Create a new SHA256 hash
	hash := sha256.New()

	// Write the string to the hash
	hash.Write([]byte(str))

	// Get the final hashed value as a byte slice
	hashedBytes := hash.Sum(nil)

	// Encode the byte slice to a hexadecimal string
	hashedString := hex.EncodeToString(hashedBytes)
	returnHash := hashedString[:length]

	return returnHash
}
