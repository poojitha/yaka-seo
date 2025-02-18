"use client";

import { useState } from "react";
import { Menu, Search } from "lucide-react";

export default function SidebarWithSearch() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchResults, setSearchResults] = useState([]);

  const handleSearch = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/getAllCrawledLinks?query=${encodeURIComponent(searchQuery)}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });
      const data = await response.json();
      setSearchResults(data.links || []);
    } catch (error) {
      console.error("Error searching:", error);
    } finally {
      setLoading(false);
    }
  };

  console.log("searchResults", searchResults);

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar Toggle Button */}
      <button
        className="absolute top-4 left-4 p-2 bg-gray-800 text-white rounded-full shadow-md z-50"
        onClick={() => setIsMenuOpen(!isMenuOpen)}
      >
        <Menu size={24} />
      </button>

      {/* Sidebar */}
      <div
        className={`w-64 bg-gray-800 text-white shadow-md p-4 absolute h-full transition-transform ${
          isMenuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <h2 className="text-xl font-bold mb-4">Menu</h2>
        <ul>
          <li className="p-2 hover:bg-gray-700 rounded cursor-pointer">Dashboard</li>
          <li className="p-2 hover:bg-gray-700 rounded cursor-pointer">Profile</li>
          <li className="p-2 hover:bg-gray-700 rounded cursor-pointer">Settings</li>
          <li className="p-2 hover:bg-gray-700 rounded cursor-pointer">Logout</li>
        </ul>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Search Bar */}
        <div className="p-4 bg-gray-200 shadow-md flex justify-end items-center text-black">
          <input
            type="text"
            placeholder="Type in your web site address..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full sm:w-3/4 p-2 border border-gray-400 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400 mr-2 sm:mr-4"
          />
          <button
            className="p-4 sm:p-3 bg-blue-500 text-white rounded-md shadow-md hover:bg-blue-600 flex items-center justify-center"
            onClick={handleSearch}
            disabled={loading}
          >
            {loading ? (
              <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full"></div>
            ) : (
              <Search size={20} />
            )}
          </button>
        </div>

        {/* Search Results Table */}
        <div className="p-6">
          {searchResults.length > 0 ? (
            <div className="overflow-x-auto mt-4">
            <div className="max-h-150 overflow-y-auto border border-gray-300 rounded-md">
              <table className="min-w-full border border-gray-300">
                <thead className="bg-gray-200 text-black">
                  <tr>
                    <th className="py-2 px-4 border-b text-left">Title</th>
                    <th className="py-2 px-4 border-b text-left">URL</th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map((result, index) => (
                    <tr key={index} className="text-black">
                      <td className="py-2 px-4 border-b">{index}</td>
                      <td className="py-2 px-4 border-b break-all">
                        <a
                          href={result}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-500 underline"
                        >
                          {result}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          
          ) : (
            <p className="text-gray-700 mt-4">No results found.</p>
          )}
        </div>
      </div>
    </div>
  );
}
