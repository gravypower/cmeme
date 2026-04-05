const memeRes = await fetch("https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Lionel_Messi_20180626.jpg/250px-Lionel_Messi_20180626.jpg");
const memeBlob = new Uint8Array(await memeRes.arrayBuffer());

const formData = new FormData();
formData.append("meme_file", new File([memeBlob], "m.jpg", {type: "image/jpeg"}));
formData.append("face_file", new File([memeBlob], "f.jpg", {type: "image/jpeg"}));

// Appending face_map string, exactly as SwapForm.tsx does:
formData.append("face_map", JSON.stringify({ "0": 0 }));

console.log("Sending to Deno proxy at port 8000...");
const res = await fetch("http://localhost:8000/api/swap", {
  method: "POST",
  body: formData
});

console.log("Deno Proxy Status:", res.status);
if (!res.ok) {
    console.log("Error:", await res.text());
} else {
    console.log("SUCCESS! Got back", res.headers.get("Content-Type"));
}
