cd frontend
npm install  # If not installed
npm run build
npx next export  # Generates static files in `out/`
cd ..
go build
go run main.go 