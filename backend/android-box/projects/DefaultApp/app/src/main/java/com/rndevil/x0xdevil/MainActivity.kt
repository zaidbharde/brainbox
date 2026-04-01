package com.rndevil.x0xdevil

import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    // Track current player: true for X, false for O
    private var isPlayerXTurn = true
    // Game state: 0 for empty, 1 for X, 2 for O
    private var gameState = IntArray(9) { 0 }
    // Winning combinations
    private val winPositions = arrayOf(
        intArrayOf(0, 1, 2), intArrayOf(3, 4, 5), intArrayOf(6, 7, 8), // Rows
        intArrayOf(0, 3, 6), intArrayOf(1, 4, 7), intArrayOf(2, 5, 8), // Columns
        intArrayOf(0, 4, 8), intArrayOf(2, 4, 6)             // Diagonals
    )
    private var isGameActive = true

    private lateinit var statusTextView: TextView
    private lateinit var buttons: Array<Button>

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        statusTextView = findViewById(R.id.statusTextView)
        
        // Initialize buttons array
        buttons = arrayOf(
            findViewById(R.id.btn0), findViewById(R.id.btn1), findViewById(R.id.btn2),
            findViewById(R.id.btn3), findViewById(R.id.btn4), findViewById(R.id.btn5),
            findViewById(R.id.btn6), findViewById(R.id.btn7), findViewById(R.id.btn8)
        )

        // Set click listeners for game buttons
        for (i in buttons.indices) {
            buttons[i].setOnClickListener {
                onCellClicked(it as Button, i)
            }
        }

        // Set click listener for reset button
        findViewById<Button>(R.id.resetButton).setOnClickListener {
            resetGame()
        }
    }

    private fun onCellClicked(button: Button, index: Int) {
        // If game is over or cell is already occupied, do nothing
        if (!isGameActive || gameState[index] != 0) return

        // Mark the cell in game state and UI
        if (isPlayerXTurn) {
            button.text = "X"
            gameState[index] = 1
            statusTextView.text = "Player O's Turn"
        } else {
            button.text = "O"
            gameState[index] = 2
            statusTextView.text = "Player X's Turn"
        }

        // Check if there's a winner
        if (checkWinner()) {
            val winner = if (isPlayerXTurn) "Player X Wins!" else "Player O Wins!"
            statusTextView.text = winner
            Toast.makeText(this, winner, Toast.LENGTH_SHORT).show()
            isGameActive = false
        } else if (isBoardFull()) {
            statusTextView.text = "It's a Draw!"
            Toast.makeText(this, "It's a Draw!", Toast.LENGTH_SHORT).show()
            isGameActive = false
        } else {
            // Toggle turn
            isPlayerXTurn = !isPlayerXTurn
        }
    }

    private fun checkWinner(): Boolean {
        for (winPos in winPositions) {
            if (gameState[winPos[0]] != 0 &&
                gameState[winPos[0]] == gameState[winPos[1]] &&
                gameState[winPos[1]] == gameState[winPos[2]]
            ) {
                return true
            }
        }
        return false
    }

    private fun isBoardFull(): Boolean {
        return !gameState.contains(0)
    }

    private fun resetGame() {
        isGameActive = true
        isPlayerXTurn = true
        gameState = IntArray(9) { 0 }
        statusTextView.text = "Player X's Turn"
        
        for (button in buttons) {
            button.text = ""
        }
    }
}
