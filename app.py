from flask import Flask, jsonify, send_from_directory
from pathlib import Path

app = Flask(__name__)

BASE_DIR = Path(__file__).resolve().parent


@app.route("/")
def home():
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/api/flights/<flight_type>")
def flights(flight_type):

    if flight_type not in ["departures", "arrivals"]:
        return jsonify({
            "success": False,
            "error": "Invalid flight type"
        }), 400

    # ---------------------------------------------------
    # Replace this section with your actual KLIA
    # flight-data scraper/API.
    # ---------------------------------------------------

    if flight_type == "departures":

        data = [
            {
                "time": "10:35",
                "flight_no": "MH143",
                "airline": "Malaysia Airlines",
                "destination": "Sydney",
                "gate": "C17",
                "status": "Boarding"
            },
            {
                "time": "10:50",
                "flight_no": "MH603",
                "airline": "Malaysia Airlines",
                "destination": "Singapore",
                "gate": "G8",
                "status": "Scheduled"
            }
        ]

    else:

        data = [
            {
                "time": "10:42",
                "flight_no": "MH715",
                "airline": "Malaysia Airlines",
                "origin": "Denpasar",
                "gate": "C3",
                "status": "Landed"
            },
            {
                "time": "11:05",
                "flight_no": "MH123",
                "airline": "Malaysia Airlines",
                "origin": "Melbourne",
                "gate": "C22",
                "status": "Expected"
            }
        ]

    return jsonify({
        "success": True,
        "type": flight_type,
        "data": data
    })


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=5000,
        debug=True
    )
