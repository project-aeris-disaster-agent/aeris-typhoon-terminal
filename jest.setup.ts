import "@testing-library/jest-dom";

if (typeof window !== "undefined" && !window.URL.createObjectURL) {
  window.URL.createObjectURL = jest.fn(() => "blob:mock");
}
