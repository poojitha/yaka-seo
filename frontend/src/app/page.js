"use client";
import Image from "next/image";
import { Menu, Search } from "lucide-react";
import { useState } from "react";

export default function Home() {

  const [isMenuOpen, setIsMenuOpen] = useState(false);

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
      className={`w-64 bg-gray-800 text-white shadow-md p-4 absolute h-full transition-transform ${isMenuOpen ? "translate-x-0" : "-translate-x-full"}`}
    >
      <h2 className="text-xl font-bold mb-4">&nbsp;</h2>
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
      <div className="p-4 bg-gray-200 shadow-md flex justify-end">
        <input
          type="text"
          placeholder="Search..."
         className="w-3/4 p-2 border border-gray-400 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400 mr-4"
        />
        <button className="p-2 bg-blue-500 text-white rounded-md shadow-md hover:bg-blue-600">
          <Search size={20} />
        </button>
      </div>

      {/* Content */}
      <div className="p-6"> 
        <h1 className="text-2xl font-semibold text-gray-800">Welcome!</h1>
        <p className="text-gray-700">Start by selecting a menu option.</p>
      </div>
    </div>
  </div>
  );
}
